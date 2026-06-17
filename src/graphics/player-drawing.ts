import { Graphics, Player, Enemy, getPetalStats, PLAYER_SIZE } from './core';
import { getActivePlayerSkin, getCustomSkin, renderCustomSkinShapes } from './player-skins';

declare module './core' {
    interface Graphics {
        drawPlayer(player: Player, socket: string, petalExtension?: number, enemies?: Map<string, Enemy>): void;
        drawPlayerPetals(player: Player, petalExtension?: number, enemies?: Map<string, Enemy>, currentPlayerId?: string): void;
        drawPlayerHealthBar(player: Player): void;
        darkenColor(hex: string, percent?: number): string;
    }
}

// Symbol-keyed so JSON.stringify skips them. The client emits its loadout to the
// server on every change; if these caches lived on string keys they would be
// serialized (canvases stringify to {}), round-tripped back, and the truthy-but-
// empty value would short-circuit the cache-resolve branch on the next render.
const PETAL_FRAMES_CACHE = Symbol('petalFramesCache');
const PETAL_KEY_CACHE = Symbol('petalKeyCache');
const PETAL_STATS_CACHE = Symbol('petalStatsCache');

export function getThirdEyeRarity(player: Player): string | undefined {
    if (!player.loadout) return undefined;
    for (const item of player.loadout) {
        if (item && item.type === 'petal' && item.petalType === 'third_eye' && item.rarity) {
            return item.rarity as string;
        }
    }
    return undefined;
}

Graphics.prototype.drawPlayer = function(this: Graphics, player: Player, socket: string, petalExtension: number = 1.0, enemies: Map<string, Enemy> = new Map()) {
    this.ctx.save();
    this.ctx.translate(player.x, player.y);

    const sizeMultiplier = player.sizeMultiplier ?? 1.0;
    const flowerRadius = 25 * sizeMultiplier;
    const hitboxRadius = (PLAYER_SIZE / 2) * sizeMultiplier;

    // Draw hitbox if enabled — circular, matches checkPlayerEnemyCollision
    if (this.showHitboxes) {
        this.ctx.save();
        this.ctx.strokeStyle = 'red';
        this.ctx.lineWidth = 2;
        this.ctx.globalAlpha = 1.0;
        this.ctx.shadowBlur = 0;
        this.ctx.beginPath();
        this.ctx.arc(0, 0, hitboxRadius, 0, Math.PI * 2);
        this.ctx.stroke();
        this.ctx.restore();
    }

    // Draw player name and health bar
    this.drawPlayerHealthBar(player);

    // Apply spinning animation when charging in a teleporter
    if (player.teleporterCharging && player.teleporterChargeStart) {
        const elapsed = this.frameTimestamp - player.teleporterChargeStart;
        const spinAngle = elapsed * 0.008;
        this.ctx.rotate(spinAngle);
    }

    // Resolve the smoothed eye offset. The local player uses the shared
    // this.playerEye accumulator; remote players (and bots) each carry their own.
    let eyeX: number;
    let eyeY: number;
    const targetEyeX = Math.cos(player.angle) * 2;
    const targetEyeY = Math.sin(player.angle) * 4.4;
    const lerpFactor = 0.15;
    if (player.id === socket) {
        this.playerEye.x += (targetEyeX - this.playerEye.x) * lerpFactor;
        this.playerEye.y += (targetEyeY - this.playerEye.y) * lerpFactor;
        eyeX = this.playerEye.x;
        eyeY = this.playerEye.y;
    } else {
        if (!player.eye) {
            player.eye = { x: 0, y: 0 };
            player.targetEye = { x: 0, y: 0 };
        }
        // Same formula as the local player so remote players' eyes look in their
        // facing direction rather than 90° off.
        player.targetEye = { x: targetEyeX, y: targetEyeY };
        player.eye.x += (player.targetEye.x - player.eye.x) * lerpFactor;
        player.eye.y += (player.targetEye.y - player.eye.y) * lerpFactor;
        eyeX = player.eye.x;
        eyeY = player.eye.y;
    }

    // Build the flower attributes once, then either hand them to the active
    // custom skin (when a render flag is set) or to the default flower renderer.
    const flowerAttrs = {
        radius: flowerRadius,
        color: player.flowerColor || '#FFE763',
        faceFlags: player.faceFlags || 0,
        equipFlags: player.equipFlags || 0,
        eyeX,
        eyeY,
        mouth: player.mouth ?? 14.5,
        cutterAngle: player.cutterAngle,
        thirdEyeRarity: getThirdEyeRarity(player),
    };

    // Render priority: an equipped user-created skin wins, then a built-in skin
    // flag, then the default flower.
    const customSkin = getCustomSkin(player.equippedSkinId);
    const builtinSkin = customSkin ? undefined : getActivePlayerSkin(player.renderFlags);
    this.ctx.save();
    if (customSkin) {
        renderCustomSkinShapes(this.ctx, customSkin.shapes, flowerRadius);
    } else if (builtinSkin) {
        builtinSkin.render(this, { ...flowerAttrs, renderFlags: player.renderFlags || 0 });
    } else {
        this.drawFlower(flowerAttrs);
    }
    this.ctx.restore();

    // Reset rotation before drawing petals so they don't spin
    if (player.teleporterCharging && player.teleporterChargeStart) {
        const elapsed = this.frameTimestamp - player.teleporterChargeStart;
        const spinAngle = elapsed * 0.008;
        this.ctx.rotate(-spinAngle);
    }

    // Draw petals around player (while still in player's transform context)
    // This ensures petals are positioned relative to the player
    this.drawPlayerPetals(player, petalExtension, enemies, socket);

    this.ctx.restore();
};

Graphics.prototype.drawPlayerPetals = function(this: Graphics, player: Player, petalExtension: number = 1.0, enemies: Map<string, Enemy> = new Map(), currentPlayerId?: string) {
    if (!player.loadout || !Array.isArray(player.loadout)) {
        return;
    }

    // Single pass over the loadout: build instances, cache stats per-petal,
    // and accumulate aggregate range/rotation modifiers. The previous version
    // walked the loadout twice and called getPetalStats up to three times per
    // instance (once in build, once for modifiers, once in render). With many
    // petals onscreen each player is rendered, so the duplicated lookups
    // showed up as a real cost.
    type Inst = { petal: any; instanceIndex: number; loadoutIndex: number; slotIndex: number; stats: any };
    const petalInstances: Inst[] = [];
    let nextSlotIndex = 0;
    let playerRangeModifier = 1.0;
    let playerRotationSpeedModifier = 1.0;

    const loadout = player.loadout;
    const loadoutLen = Math.min(10, loadout.length);
    for (let loadoutIndex = 0; loadoutIndex < loadoutLen; loadoutIndex++) {
        const item: any = loadout[loadoutIndex];
        if (!item || item.type !== 'petal' || !item.petalType || !item.rarity) continue;

        // Cache stats on the petal item itself. The loadout array is replaced
        // wholesale on each server snapshot, so this cache lives only as long
        // as the snapshot — which is fine, and avoids the per-frame dictionary
        // lookup in getPetalStats.
        let stats = item[PETAL_STATS_CACHE];
        if (stats === undefined) {
            stats = getPetalStats(item.petalType, item.rarity) ?? null;
            item[PETAL_STATS_CACHE] = stats;
        }
        if (!stats) continue;

        const rawCount = stats.count;
        const count = (typeof rawCount === 'number' && rawCount >= 1 && isFinite(rawCount)) ? rawCount : 1;

        const mods = stats.playerModifiers;
        if (mods) {
            if (mods.range !== undefined) playerRangeModifier *= mods.range;
            if (mods.rotationSpeed !== undefined) playerRotationSpeedModifier += mods.rotationSpeed - 1;
        }

        const clumped = !!stats.clumped;
        const sharedSlot = nextSlotIndex;
        for (let i = 0; i < count; i++) {
            const slotIndex = clumped ? sharedSlot : nextSlotIndex;
            if (!clumped) nextSlotIndex++;
            petalInstances.push({ petal: item, instanceIndex: i, loadoutIndex, slotIndex, stats });
        }
        if (clumped) nextSlotIndex++;
    }

    if (petalInstances.length === 0) {
        if (this.petalPhysicsStates.size > 0) {
            const keysToDelete: string[] = [];
            this.petalPhysicsStates.forEach((_value, key) => {
                if (key.startsWith(player.id)) keysToDelete.push(key);
            });
            for (const k of keysToDelete) this.petalPhysicsStates.delete(k);
        }
        return;
    }

    const currentTime = this.frameTimestamp;
    const playerSizeMultiplier = player.sizeMultiplier ?? 1.0;
    const baseRadius = (60 + (PLAYER_SIZE / 2) * (playerSizeMultiplier - 1)) * petalExtension;
    const totalSlots = nextSlotIndex;
    const angleStep = totalSlots > 0 ? (Math.PI * 2) / totalSlots : 0;

    const ctx = this.ctx;
    const showGlow = this.showRarityGlow;
    const playerX = player.x;
    const playerY = player.y;
    const serverPositions: any[] | undefined = player.petalPositions;
    const petalCache = this.petalImageCache;

    for (let idx = 0, n = petalInstances.length; idx < n; idx++) {
        const inst = petalInstances[idx];
        const petal = inst.petal;
        const stats = inst.stats;

        if (petal.onCooldown) continue;

        const slotIndex = inst.slotIndex;
        const loadoutIndex = inst.loadoutIndex;
        const instanceIndex = inst.instanceIndex;

        const fixedDirection = stats.fixedDirection;
        const rotationSpeed = (stats.speed ?? 1.0) * playerRotationSpeedModifier * 0.002;
        const baseAngle = slotIndex * angleStep;
        const rotationAngle = (currentTime * rotationSpeed) % (Math.PI * 2);
        const totalAngle = fixedDirection !== undefined ? baseAngle : baseAngle + rotationAngle;

        const petalRange = (stats.range ?? 1.0) * playerRangeModifier;
        const petalRadius = baseRadius * petalRange;

        const customSize = petal.customSize;
        const baseStatsSize = stats.size;
        const clumpCount = stats.count || 1;
        const clumpSize = customSize !== undefined ? customSize : baseStatsSize;
        const useClump = !!stats.clumped && clumpCount > 1;
        let clumpOffsetX = 0;
        let clumpOffsetY = 0;
        if (useClump) {
            const clumpSpacing = clumpSize * 20; // 40 * 0.5
            const clumpSubAngle = (instanceIndex / clumpCount) * Math.PI * 2 + totalAngle;
            clumpOffsetX = Math.cos(clumpSubAngle) * clumpSpacing;
            clumpOffsetY = Math.sin(clumpSubAngle) * clumpSpacing;
        }

        let petalX: number;
        let petalY: number;
        if (fixedDirection !== undefined) {
            petalX = 0;
            petalY = 0;
        } else if (stats.noPhysics) {
            petalX = Math.cos(totalAngle) * petalRadius + clumpOffsetX;
            petalY = Math.sin(totalAngle) * petalRadius + clumpOffsetY;
        } else {
            let foundX: number | null = null;
            let foundY: number | null = null;
            if (serverPositions) {
                for (let j = 0, m = serverPositions.length; j < m; j++) {
                    const sp = serverPositions[j];
                    if (sp.loadoutIndex === loadoutIndex && sp.instanceIndex === instanceIndex) {
                        foundX = sp.x;
                        foundY = sp.y;
                        break;
                    }
                }
            }
            if (foundX !== null) {
                // Server petal positions are absolute coords orbiting the player's
                // SERVER position. The local flower renders at its predicted position
                // (client-side prediction), so anchor petals to the *smoothed* server
                // reference (_refX/_refY) — using the raw 30Hz targetX/Y would subtract
                // a stairstep from the interpolated petal and make petals jitter. Falls
                // back to targetX/playerX. Only the local player has serverPositions.
                const refX = player._refX ?? player.targetX ?? playerX;
                const refY = player._refY ?? player.targetY ?? playerY;
                petalX = foundX - refX;
                petalY = (foundY as number) - refY;
            } else if (serverPositions && clumpCount > 1) {
                // Multi-instance petal: the server omits an instance from petalPositions
                // once it has broken (per-instance health/cooldown). Hide just that
                // particle instead of drawing a phantom at its orbit slot while its
                // siblings keep spinning.
                continue;
            } else {
                petalX = Math.cos(totalAngle) * petalRadius + clumpOffsetX;
                petalY = Math.sin(totalAngle) * petalRadius + clumpOffsetY;
            }
        }

        const effectiveSize = customSize !== undefined ? customSize : baseStatsSize;
        const petalSize = 12 * effectiveSize;
        const halfPetal = petalSize * 0.5;

        ctx.save();
        ctx.translate(petalX, petalY);

        if (this.showHitboxes) {
            const petalHitboxRadius = 20 * effectiveSize;
            ctx.save();
            ctx.strokeStyle = 'red';
            ctx.lineWidth = 2;
            ctx.globalAlpha = 1.0;
            ctx.shadowBlur = 0;
            ctx.beginPath();
            ctx.arc(0, 0, petalHitboxRadius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }

        if (stats.emissive) {
            const hex = stats.lightColor || stats.color || '#ffffff';
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            const lightRadius = stats.lightRadius ?? (petalSize * 3);
            const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, lightRadius);
            gradient.addColorStop(0, `rgba(${r},${g},${b},0.6)`);
            gradient.addColorStop(0.4, `rgba(${r},${g},${b},0.25)`);
            gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.arc(0, 0, lightRadius, 0, Math.PI * 2);
            ctx.fill();
        }

        if (fixedDirection !== undefined) {
            ctx.rotate(fixedDirection);
        } else {
            ctx.rotate(rotationAngle + Math.PI / 2);
        }

        const vOffX = stats.visualOffsetX ?? 0;
        const vOffY = stats.visualOffsetY ?? 0;
        if (vOffX !== 0 || vOffY !== 0) {
            ctx.translate(vOffX, vOffY);
        }

        // Resolve the petal frame via a cached canvas reference on the petal
        // (no per-frame string concat or object key lookup). Symbol-keyed so
        // the cached canvas (which JSON.stringify would emit as {}) cannot
        // ride along when the loadout is round-tripped through the server.
        let petalFrames = petal[PETAL_FRAMES_CACHE];
        let petalKey: string = petal[PETAL_KEY_CACHE];
        if (petalFrames === undefined) {
            petalKey = `${petal.petalType}_${petal.rarity}`;
            petalFrames = petalCache[petalKey] ?? null;
            petal[PETAL_FRAMES_CACHE] = petalFrames;
            petal[PETAL_KEY_CACHE] = petalKey;
        }

        // Use Math.floor — `| 0` truncates to int32 and produces a negative
        // index for Date.now()-scale timestamps, which would land on an
        // undefined frame and silently drop the petal to the fallback path.
        let petalCanvas: HTMLCanvasElement | null = null;
        if (petalFrames) {
            if (Array.isArray(petalFrames)) {
                petalCanvas = petalFrames[Math.floor((currentTime / 42) % petalFrames.length)];
            } else {
                petalCanvas = petalFrames;
            }
        }

        if (petalCanvas && petalCanvas.width > 0 && petalCanvas.height > 0) {
            if (showGlow) {
                const glowCanvas = this.getPetalGlowCanvas(petalKey, petal.rarity, currentTime);
                if (glowCanvas) {
                    const scale = glowCanvas.width / petalCanvas.width;
                    const drawSize = petalSize * scale;
                    ctx.drawImage(glowCanvas, -drawSize / 2, -drawSize / 2, drawSize, drawSize);
                } else {
                    ctx.drawImage(petalCanvas, -halfPetal, -halfPetal, petalSize, petalSize);
                }
            } else {
                ctx.drawImage(petalCanvas, -halfPetal, -halfPetal, petalSize, petalSize);
            }
        } else {
            const hue = (slotIndex * 40) % 360;
            ctx.fillStyle = `hsl(${hue}, 70%, 50%)`;
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.ellipse(0, 0, halfPetal, halfPetal, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
        }

        ctx.restore();

        // High-rarity petal sparkle. Check rarity before rolling the dice so
        // common petals (the bulk of equipped slots) skip the Math.random call.
        const rarity = petal.rarity;
        if ((rarity === 'ultra' || rarity === 'super' || rarity === 'unique' || rarity === 'apex') && Math.random() < 0.1) {
            this.showPetalParticleEffect(playerX + petalX, playerY + petalY, rarity);
        }
    }
};

Graphics.prototype.drawPlayerHealthBar = function(this: Graphics, player: Player) {
    const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'ultra', 'super', 'unique', 'apex'];

    // Reset any effects that might interfere with text rendering
    this.ctx.globalAlpha = 1.0;
    this.ctx.shadowBlur = 0;
    this.ctx.shadowColor = 'transparent';

    const sizeMultiplier = player.sizeMultiplier ?? 1.0;
    const healthBarWidth = 60;
    const healthBarHeight = 8;
    const healthBarY = (PLAYER_SIZE / 2) * sizeMultiplier + 24;
    const radius = healthBarHeight / 2;

    // Draw player name above health bar, left-aligned
    this.ctx.textAlign = 'left';
    this.ctx.font = '12px Ubuntu, sans-serif';
    this.ctx.strokeStyle = '#000000';
    this.ctx.lineWidth = 3;
    const nameX = -healthBarWidth / 2;
    const nameY = healthBarY - 4;
    this.ctx.strokeText(player.name || 'Unnamed', nameX, nameY);
    this.ctx.fillStyle = 'white';
    this.ctx.fillText(player.name || 'Unnamed', nameX, nameY);

    // Health bar background (rounded)
    this.ctx.fillStyle = 'rgba(0, 0, 0, 1.0)';
    this.ctx.beginPath();
    this.ctx.roundRect(-healthBarWidth / 2 - 1, healthBarY - 1, healthBarWidth + 2, healthBarHeight + 2, radius);
    this.ctx.fill();

    // Health bar fill (rounded)
    const clampedHealth = Math.max(0, Math.min(player.health, player.maxHealth));
    const healthFillWidth = (clampedHealth / player.maxHealth) * healthBarWidth;

    // Track invulnerability fade state
    const fadeState = this.invulFadeStates.get(player.id);
    if (player.isInvulnerable) {
        this.invulFadeStates.set(player.id, { endTime: 0, wasInvulnerable: true });
    } else if (fadeState?.wasInvulnerable) {
        // Just transitioned out of invulnerability - start fade
        fadeState.endTime = this.frameTimestamp;
        fadeState.wasInvulnerable = false;
    }

    // Determine health bar color with fade
    let healthColor = '#73ff54'; // default green
    if (player.isInvulnerable) {
        healthColor = '#faffc9'; // XP bar yellow
    } else if (fadeState?.endTime) {
        const elapsed = this.frameTimestamp - fadeState.endTime;
        const t = Math.min(elapsed / this.INVUL_FADE_DURATION, 1);
        if (t < 1) {
            // Lerp from yellow (#faffc9) to green (#73ff54)
            const r = Math.round(0xfa + (0x73 - 0xfa) * t);
            const g = Math.round(0xff + (0xff - 0xff) * t);
            const b = Math.round(0xc9 + (0x54 - 0xc9) * t);
            healthColor = `rgb(${r}, ${g}, ${b})`;
        } else {
            this.invulFadeStates.delete(player.id);
        }
    }

    this.ctx.fillStyle = healthColor;
    this.ctx.beginPath();
    this.ctx.roundRect(-healthBarWidth / 2, healthBarY, healthFillWidth, healthBarHeight, radius);
    this.ctx.fill();

    // Determine max rarity from player loadout
    let maxRarityIndex = 0;
    if (player.loadout && Array.isArray(player.loadout)) {
        for (const item of player.loadout) {
            if (item && item.rarity) {
                const idx = RARITY_ORDER.indexOf(item.rarity);
                if (idx > maxRarityIndex) {
                    maxRarityIndex = idx;
                }
            }
        }
    }
    const maxRarity = RARITY_ORDER[maxRarityIndex];
    const rarityColor = this.ITEM_RARITY_COLORS[maxRarity as keyof typeof this.ITEM_RARITY_COLORS];

    // Draw level label below health bar, right-aligned
    this.ctx.textAlign = 'right';
    this.ctx.fillStyle = rarityColor;
    this.ctx.font = '10px Ubuntu, sans-serif';
    this.ctx.strokeStyle = '#000000';
    this.ctx.lineWidth = 3;
    const levelX = healthBarWidth / 2;
    const levelY = healthBarY + healthBarHeight + 12;
    const levelLabel = `Lv. ${player.level}`;
    this.ctx.strokeText(levelLabel, levelX, levelY);
    this.ctx.fillText(levelLabel, levelX, levelY);

    // Draw guild tag below health bar, left-aligned — mirrors the level label position
    // so the two sit on opposite sides under the bar. Smaller font so a 5-char
    // ID plus brackets doesn't collide with the right-aligned level label.
    if (player.guildName) {
        this.ctx.textAlign = 'left';
        this.ctx.font = '8px Ubuntu, sans-serif';
        this.ctx.strokeStyle = '#000000';
        this.ctx.lineWidth = 2;
        const tagX = -healthBarWidth / 2;
        const tagY = levelY;
        const tag = `[${player.guildName}]`;
        this.ctx.strokeText(tag, tagX, tagY);
        this.ctx.fillStyle = '#27dade';
        this.ctx.fillText(tag, tagX, tagY);
    }
};

/**
 * Darken a hex color by a specified percentage
 * @param hex - Hex color string (e.g., '#7eef6d')
 * @param percent - Percentage to darken (0-100, default 30)
 * @returns Darkened hex color string
 */
Graphics.prototype.darkenColor = function(this: Graphics, hex: string, percent: number = 30): string {
    // Remove # if present
    const num = parseInt(hex.replace('#', ''), 16);

    // Extract RGB components
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;

    // Darken each component
    const factor = 1 - (percent / 100);
    const newR = Math.round(r * factor);
    const newG = Math.round(g * factor);
    const newB = Math.round(b * factor);

    // Convert back to hex
    return `#${((newR << 16) | (newG << 8) | newB).toString(16).padStart(6, '0')}`;
};
