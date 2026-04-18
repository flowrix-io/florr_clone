import { Graphics, Player, Enemy, getPetalStats, PLAYER_SIZE } from './core';

declare module './core' {
    interface Graphics {
        drawPlayer(player: Player, socket: string, petalExtension?: number, enemies?: Map<string, Enemy>): void;
        drawPlayerPetals(player: Player, petalExtension?: number, enemies?: Map<string, Enemy>, currentPlayerId?: string): void;
        drawPlayerHealthBar(player: Player): void;
        darkenColor(hex: string, percent?: number): string;
    }
}

Graphics.prototype.drawPlayer = function(this: Graphics, player: Player, socket: string, petalExtension: number = 1.0, enemies: Map<string, Enemy> = new Map()) {
    this.ctx.save();
    this.ctx.translate(player.x, player.y);

    // Draw hitbox if enabled
    if (this.showHitboxes) {
        this.ctx.save();
        this.ctx.strokeStyle = 'red';
        this.ctx.lineWidth = 2;
        this.ctx.globalAlpha = 1.0; // Ensure hitbox is always fully opaque
        this.ctx.shadowBlur = 0; // Remove any glow effects for hitbox
        this.ctx.strokeRect(-PLAYER_SIZE / 2, -PLAYER_SIZE / 2, PLAYER_SIZE, PLAYER_SIZE);
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

    // Draw player sprite
    if (player.id === socket) {
        // Calculate target eye position
        const targetEye = {
            x: Math.cos(player.angle) * 2,
            y: Math.sin(player.angle) * 4.4
        };

        // Smooth interpolation of eye position (lerp factor controls smoothness)
        const lerpFactor = 0.15;
        this.playerEye.x += (targetEye.x - this.playerEye.x) * lerpFactor;
        this.playerEye.y += (targetEye.y - this.playerEye.y) * lerpFactor;

        this.ctx.save();
        this.drawFlower({
            radius: 25,
            color: player.flowerColor || '#FFE763',
            faceFlags: player.faceFlags || 0,
            equipFlags: player.equipFlags || 0,
            eyeX: this.playerEye.x,
            eyeY: this.playerEye.y,
            mouth: player.mouth ?? 14.5,
            cutterAngle: player.cutterAngle,
        });
        this.ctx.restore();
    } else {
        // For other players, use their own smooth eye interpolation
        if (!player.eye) {
            player.eye = { x: 0, y: 0 };
            player.targetEye = { x: 0, y: 0 };
        }

        // Target eye position — same formula as the local player so remote
        // players' (and bots') eyes look in their facing direction rather than
        // 90° off.
        player.targetEye = {
            x: Math.cos(player.angle) * 2,
            y: Math.sin(player.angle) * 4.4
        };

        // Smooth interpolation
        const lerpFactor = 0.15;
        player.eye.x += (player.targetEye.x - player.eye.x) * lerpFactor;
        player.eye.y += (player.targetEye.y - player.eye.y) * lerpFactor;

        this.ctx.save();
        this.drawFlower({
            radius: 25,
            color: player.flowerColor || '#FFE763',
            faceFlags: player.faceFlags || 0,
            equipFlags: player.equipFlags || 0,
            eyeX: player.eye.x,
            eyeY: player.eye.y,
            mouth: player.mouth ?? 14.5,
            cutterAngle: player.cutterAngle,
        });
        this.ctx.restore();
    }

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
    // Safety check: ensure player loadout exists before filtering
    if (!player.loadout || !Array.isArray(player.loadout)) {
        return; // Skip drawing petals if loadout is not properly initialized
    }

    // IMPORTANT: This function is called from within drawPlayer(), which means:
    // - The context has: scale(zoomLevel), translate(-cameraX, -cameraY), translate(player.x, player.y)
    // - We need to draw petals relative to the player position (which is already translated)
    // - So we should use relative coordinates (0, 0 is player center) or translate from player position


    // Get all petals from player loadout and expand based on count property
    const petalInstances: Array<{petal: any, instanceIndex: number, loadoutIndex: number, slotIndex: number}> = [];
    let nextSlotIndex = 0;
    try {
        player.loadout.forEach((item: any, loadoutIndex: number) => {
            // Secondary loadout (slots 10+) is storage only — don't render petals
            if (loadoutIndex >= 10) return;
            if (item && item.type === 'petal' && item.petalType && item.rarity) {
                const stats = getPetalStats(item.petalType, item.rarity);
                if (!stats) return;

                const count = stats.count || 1; // Use count from stats, default to 1

                // Validate count is a valid number
                if (typeof count !== 'number' || count < 1 || !isFinite(count)) {
                    console.warn('Invalid petal count:', count, 'for', item.petalType, item.rarity);
                    return;
                }

                // Clumped petals share a single orbit slot across all their instances
                const clumped = !!stats.clumped;
                const sharedSlot = nextSlotIndex;
                // Create multiple instances based on count
                for (let i = 0; i < count; i++) {
                    const slotIndex = clumped ? sharedSlot : nextSlotIndex;
                    if (!clumped) nextSlotIndex++;
                    petalInstances.push({ petal: item, instanceIndex: i, loadoutIndex, slotIndex });
                }
                if (clumped) nextSlotIndex++;
            }
        });
    } catch (error) {
        console.error('Error building petal instances:', error);
        return;
    }

    if (petalInstances.length === 0) {
        // Clean up physics states for this player if no petals
        const keysToDelete: string[] = [];
        this.petalPhysicsStates.forEach((value: any, key: string) => {
            if (key.startsWith(player.id)) {
                keysToDelete.push(key);
            }
        });
        keysToDelete.forEach(key => this.petalPhysicsStates.delete(key));
        return;
    }

    const currentTime = Date.now();

    // Clean up physics states for petals that no longer exist in loadout
    const activePetalIds = new Set<string>();
    petalInstances.forEach(({loadoutIndex, instanceIndex}) => {
        activePetalIds.add(`${player.id}_${loadoutIndex}_${instanceIndex}`);
    });
    const keysToDelete: string[] = [];
    this.petalPhysicsStates.forEach((value: any, key: string) => {
        if (key.startsWith(player.id) && !activePetalIds.has(key)) {
            keysToDelete.push(key);
        }
    });
    keysToDelete.forEach(key => this.petalPhysicsStates.delete(key));
    const baseRadius = 60 * petalExtension; // Distance from player center, modified by extension
    const totalSlots = nextSlotIndex;
    const angleStep = totalSlots > 0 ? (Math.PI * 2) / totalSlots : 0; // Evenly space petals across slots (clumped petals share a slot)

    // Calculate player range and rotation speed modifiers from equipped petals
    let playerRangeModifier = 1.0;
    let playerRotationSpeedModifier = 1.0;
    for (const item of player.loadout) {
        if (item && item.type === 'petal' && item.petalType && item.rarity) {
            const pStats = getPetalStats(item.petalType, item.rarity);
            if (pStats?.playerModifiers?.range !== undefined) {
                playerRangeModifier *= pStats.playerModifiers.range;
            }
            if (pStats?.playerModifiers?.rotationSpeed !== undefined) {
                playerRotationSpeedModifier *= pStats.playerModifiers.rotationSpeed;
            }
        }
    }

    // Calculate deltaTime (approximate, using frame timing)
    // Use a default of 1/60 seconds (60 FPS) if we can't calculate it
    const lastFrameTime = (this as any).lastFrameTime || currentTime;
    const deltaTime = Math.min((currentTime - lastFrameTime) / 1000, 1/30); // Cap at 30 FPS minimum
    (this as any).lastFrameTime = currentTime;

    petalInstances.forEach(({petal, instanceIndex, loadoutIndex, slotIndex}) => {
        if (!petal || !petal.petalType || !petal.rarity) {
            return;
        }

        const stats = getPetalStats(petal.petalType, petal.rarity);
        if (!stats) {
            return;
        }

        // Skip drawing if petal is on cooldown
        if (petal.onCooldown) {
            return;
        }

        // Calculate rotation angle
        const rotationSpeed = (stats.speed ?? 1.0) * playerRotationSpeedModifier * 0.002; // Convert to radians per ms
        const baseAngle = slotIndex * angleStep;
        const rotationAngle = (currentTime * rotationSpeed) % (Math.PI * 2);
        // Fixed-direction petals don't orbit - they stay at a fixed relative position
        const totalAngle = stats.fixedDirection !== undefined ? baseAngle : baseAngle + rotationAngle;

        // Apply petal range multiplier and player range modifier to base radius
        const petalRange = (stats.range ?? 1.0) * playerRangeModifier;
        const petalRadius = baseRadius * petalRange;

        // Clumped petals arrange instances in a small cluster around the slot center
        const clumpCount = stats.count || 1;
        const clumpSize = (petal as any).customSize !== undefined ? (petal as any).customSize : stats.size;
        const useClump = stats.clumped && clumpCount > 1;
        const clumpSpacing = clumpSize * 40 * 0.5;
        const clumpSubAngle = useClump ? (instanceIndex / clumpCount) * Math.PI * 2 + totalAngle : 0;
        const clumpOffsetX = useClump ? Math.cos(clumpSubAngle) * clumpSpacing : 0;
        const clumpOffsetY = useClump ? Math.sin(clumpSubAngle) * clumpSpacing : 0;

        // Use server-provided petal positions if available (for all players)
        let petalX: number;
        let petalY: number;

        // Check if we have server-provided petal positions
        const serverPetalPos = player.petalPositions?.find(
            (p: any) => p.loadoutIndex === loadoutIndex && p.instanceIndex === instanceIndex
        );

        if (stats.fixedDirection !== undefined) {
            // Fixed-direction petals stay directly on the player
            petalX = 0;
            petalY = 0;
        } else if (stats.noPhysics) {
            // noPhysics petals compute orbit position locally each frame — no server interpolation lag
            petalX = Math.cos(totalAngle) * petalRadius + clumpOffsetX;
            petalY = Math.sin(totalAngle) * petalRadius + clumpOffsetY;
        } else if (serverPetalPos) {
            // Use server-provided position (already interpolated on client)
            // Convert from world coordinates to relative coordinates for rendering
            petalX = serverPetalPos.x - player.x;
            petalY = serverPetalPos.y - player.y;
        } else {
            // Fallback: Calculate target orbit position if server positions not available yet
            // This can happen during initial load or if server hasn't sent positions yet
            const targetX = player.x + Math.cos(totalAngle) * petalRadius + clumpOffsetX;
            const targetY = player.y + Math.sin(totalAngle) * petalRadius + clumpOffsetY;
            petalX = targetX - player.x;
            petalY = targetY - player.y;
        }

        // Petal positions are now provided by the server and interpolated on the client
        // No client-side physics simulation needed

        // Draw petal - set up transforms first (same pattern as mobs)
        // Check for custom size first, then use base stats
        const effectiveSize = (petal as any).customSize !== undefined ? (petal as any).customSize : stats.size;
        const size = 12 * effectiveSize;
        const petalSize = size;

        // Save context state before drawing this petal
        // IMPORTANT: Each petal needs its own save/restore to prevent transform interference
        // At this point, the context has: scale(zoomLevel), translate(-cameraX, -cameraY), translate(player.x, player.y)
        // So (0, 0) is the player's center
        this.ctx.save();

        // Apply transforms for this specific petal
        // petalX and petalY are relative to player center (0, 0)
        // IMPORTANT: The order MUST be translate then rotate for rotation to happen around petal position
        // If we rotate first, it rotates around (0, 0) which is the player center
        // If we translate first, then rotate, it rotates around the petal position

        // Step 1: Translate to petal's orbital position (relative to player)
        this.ctx.translate(petalX, petalY);

        // Draw emissive light glow behind petal (before rotation so glow stays circular)
        if (stats.emissive) {
            const hex = stats.lightColor || stats.color || '#ffffff';
            const r = parseInt(hex.slice(1, 3), 16);
            const g = parseInt(hex.slice(3, 5), 16);
            const b = parseInt(hex.slice(5, 7), 16);
            const lightRadius = stats.lightRadius ?? (petalSize * 3);
            this.ctx.save();
            const gradient = this.ctx.createRadialGradient(0, 0, 0, 0, 0, lightRadius);
            gradient.addColorStop(0, `rgba(${r},${g},${b},0.6)`);
            gradient.addColorStop(0.4, `rgba(${r},${g},${b},0.25)`);
            gradient.addColorStop(1, `rgba(${r},${g},${b},0)`);
            this.ctx.fillStyle = gradient;
            this.ctx.beginPath();
            this.ctx.arc(0, 0, lightRadius, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.restore();
        }

        // Step 2: Rotate around the petal's position (which is now at origin after translate)
        // If fixedDirection is set, the petal always faces that angle instead of spinning
        if (stats.fixedDirection !== undefined) {
            this.ctx.rotate(stats.fixedDirection);
        } else {
            // IMPORTANT: Use only rotationAngle (not totalAngle) so the petal spins around its own center
            // totalAngle includes the orbital position, which would make it rotate around the player
            // rotationAngle is just the spinning motion, independent of orbital position
            this.ctx.rotate(rotationAngle + Math.PI / 2);
        }

        // Step 3: Apply visual offset shift if specified
        const vOffX = stats.visualOffsetX ?? 0;
        const vOffY = stats.visualOffsetY ?? 0;
        if (vOffX !== 0 || vOffY !== 0) {
            this.ctx.translate(vOffX, vOffY);
        }

        // Reset any global state that might interfere
        this.ctx.globalAlpha = 1.0;
        this.ctx.globalCompositeOperation = 'source-over';

        // Draw petal - the transforms are already applied (translate to petal position, then rotate)
        // Try to use cached SVG image
        const petalKey = `${petal.petalType}_${petal.rarity}`;
        const petalCanvas = this.getPetalCanvas(petalKey, this.frameTimestamp);

        if (petalCanvas && petalCanvas.width > 0 && petalCanvas.height > 0) {
            try {
                // Use cached canvas image
                // Draw centered at origin (which is now the petal position after translate)
                this.ctx.drawImage(
                    petalCanvas,
                    -petalSize / 2,
                    -petalSize / 2,
                    petalSize,
                    petalSize
                );

                // Add rarity glow effect (only when ALT key is held)
                if (this.showRarityGlow) {
                    const glowColor = this.ITEM_RARITY_COLORS[petal.rarity as keyof typeof this.ITEM_RARITY_COLORS] || stats.color;
                    this.ctx.save();
                    this.ctx.shadowColor = glowColor;
                    this.ctx.shadowBlur = 8;
                    for (let g = 0; g < 6; g++) {
                        this.ctx.drawImage(petalCanvas, -petalSize / 2, -petalSize / 2, petalSize, petalSize);
                    }
                    this.ctx.restore();
                }
            } catch (error) {
                console.error(`[Graphics] Error drawing petal image for ${slotIndex}:`, error);
            }
        } else {
            // Fallback to colored circle if image not loaded
            const hue = (slotIndex * 40) % 360;
            const fallbackColor = `hsl(${hue}, 70%, 50%)`;
            this.ctx.fillStyle = fallbackColor;
            this.ctx.strokeStyle = '#000000';
            this.ctx.lineWidth = 1;
            this.ctx.beginPath();
            this.ctx.ellipse(0, 0, size / 2, size / 2, 0, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.stroke();
        }

        // Always restore context state after drawing this petal
        // This restores to the state before this petal's save() (which should have player transform)
        this.ctx.restore();

        // Create particle effects for ultra, super, and unique petals
        // IMPORTANT: These effects should NOT modify the context state, as the next petal needs the same starting state
        if (['ultra', 'super', 'unique', 'apex'].includes(petal.rarity)) {
            // Only create particles occasionally to avoid performance issues
            if (Math.random() < 0.1) { // 10% chance per frame
                // Convert relative petal coordinates to absolute world coordinates
                // petalX and petalY are relative to player center, so add player position
                const worldX = player.x + petalX;
                const worldY = player.y + petalY;
                this.showPetalParticleEffect(worldX, worldY, petal.rarity);
            }
        }

    });
};

Graphics.prototype.drawPlayerHealthBar = function(this: Graphics, player: Player) {
    const RARITY_ORDER = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'ultra', 'super', 'unique', 'apex'];

    // Reset any effects that might interfere with text rendering
    this.ctx.globalAlpha = 1.0;
    this.ctx.shadowBlur = 0;
    this.ctx.shadowColor = 'transparent';

    const healthBarWidth = 60;
    const healthBarHeight = 8;
    const healthBarY = PLAYER_SIZE / 2 + 24;
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
