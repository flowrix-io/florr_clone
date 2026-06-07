import { Graphics, Player, Enemy, FaceFlags, getMobStats } from './core';
import { getThirdEyeRarity } from './player-drawing';

declare module './core' {
    interface Graphics {
        sampleColorAtPosition(worldX: number, worldY: number): string;
        drawUI(players: Map<string, Player>, socket: string): void;
        drawBossBars(enemies: Map<string, Enemy>): void;
        formatNumber(num: number): string;
        drawCorpse(x: number, y: number, angle: number, player?: Player): void;
        setShowConsoleLogs(enabled: boolean): void;
        addConsoleLog(args: any[], color: string): void;
        drawConsoleLogs(): void;
        drawDeathScreen(): void;
        showDeathScreen(killedBy?: { type: string; tier: string }): void;
        hideDeathScreen(): void;
    }
}

Graphics.prototype.sampleColorAtPosition = function(this: Graphics, worldX: number, worldY: number): string {
    // Get the current transform state to properly convert coordinates
    // Note: getImageData uses canvas pixel coordinates, not transformed coordinates
    const validCameraX = isNaN(this.cameraX) || !isFinite(this.cameraX) ? 0 : this.cameraX;
    const validCameraY = isNaN(this.cameraY) || !isFinite(this.cameraY) ? 0 : this.cameraY;

    // Convert world coordinates to canvas pixel coordinates
    // Account for zoom and camera position
    const canvasX = Math.floor((worldX - validCameraX) * this.zoomLevel);
    const canvasY = Math.floor((worldY - validCameraY) * this.zoomLevel);

    // Make sure we're within canvas bounds
    if (canvasX >= 0 && canvasX < this.viewW && canvasY >= 0 && canvasY < this.viewH) {
        try {
            // Use a small region (3x3) for more reliable sampling
            const sampleSize = 3;
            const startX = Math.max(0, canvasX - Math.floor(sampleSize / 2));
            const startY = Math.max(0, canvasY - Math.floor(sampleSize / 2));
            const endX = Math.min(this.viewW, startX + sampleSize);
            const endY = Math.min(this.viewH, startY + sampleSize);
            const actualWidth = endX - startX;
            const actualHeight = endY - startY;

            if (actualWidth > 0 && actualHeight > 0) {
                const imageData = this.ctx.getImageData(startX, startY, actualWidth, actualHeight);
                const pixelCount = imageData.data.length / 4; // Each pixel is 4 bytes (RGBA)

                if (pixelCount > 0) {
                    let rSum = 0, gSum = 0, bSum = 0;
                    for (let i = 0; i < imageData.data.length; i += 4) {
                        rSum += imageData.data[i];
                        gSum += imageData.data[i + 1];
                        bSum += imageData.data[i + 2];
                    }

                    const avgR = Math.round(rSum / pixelCount);
                    const avgG = Math.round(gSum / pixelCount);
                    const avgB = Math.round(bSum / pixelCount);

                    // Darken the color by reducing each component by 30%
                    const darkenFactor = 0.9; // 90% of original = 10% darker
                    const darkR = Math.round(avgR * darkenFactor);
                    const darkG = Math.round(avgG * darkenFactor);
                    const darkB = Math.round(avgB * darkenFactor);

                    // Return darkened rgba color with alpha 0.5
                    return `rgba(${darkR}, ${darkG}, ${darkB}, 0.5)`;
                }
            }
        } catch (error) {
            // Fallback if sampling fails
        }
    }

    // Fallback: use default background color (#00d885) darkened with alpha 0.5
    // Darken by 30%: 0 * 0.7 = 0, 216 * 0.7 = 151, 133 * 0.7 = 93
    return 'rgba(0, 151, 93, 0.5)';
};

Graphics.prototype.drawUI = function(this: Graphics, players: Map<string, Player>, socket: string) {
    // Draw player stats
    const player = players.get(socket);
    if (player) {
        // Draw flower in top left (moved down for exit button)
        const flowerCenterX = 50;
        const flowerCenterY = 120; // 50 + 70 pixels down
        const flowerEye = { x: 2, y: 0 }; // Centered eyes for UI flower

        // Position bars to slightly overlap the flower
        const healthBarWidth = 200;
        const healthBarHeight = 20;
        const healthX = flowerCenterX + 12; // Bars start slightly inside the flower
        const healthY = 97.5; // 30 + 70 pixels down
        const textX = flowerCenterX + 35; // Text is completely outside the flower

        // Draw health bar with rounded ends
        const clampedHealth = Math.max(0, player.health); // Cap health at 0
        const healthFillWidth = (clampedHealth / player.maxHealth) * healthBarWidth;
        const radius = healthBarHeight / 2;

        // Health bar background (rounded)
        this.ctx.fillStyle = 'rgba(0, 0, 0, 1.0)';
        this.ctx.beginPath();
        this.ctx.roundRect(healthX - 2, healthY - 2, healthBarWidth + 4, healthBarHeight + 4, radius);
        this.ctx.fill();

        // Health bar fill (rounded) - match invulnerability color from in-world bar
        const fadeState = this.invulFadeStates.get(socket);
        let hudHealthColor = '#73ff54';
        if (player.isInvulnerable) {
            hudHealthColor = '#faffc9';
        } else if (fadeState?.endTime) {
            const elapsed = this.frameTimestamp - fadeState.endTime;
            const t = Math.min(elapsed / this.INVUL_FADE_DURATION, 1);
            if (t < 1) {
                const r = Math.round(0xfa + (0x73 - 0xfa) * t);
                const g = Math.round(0xff + (0xff - 0xff) * t);
                const b = Math.round(0xc9 + (0x54 - 0xc9) * t);
                hudHealthColor = `rgb(${r}, ${g}, ${b})`;
            }
        }
        this.ctx.fillStyle = hudHealthColor;
        this.ctx.beginPath();
        this.ctx.roundRect(healthX, healthY, healthFillWidth, healthBarHeight, radius);
        this.ctx.fill();

        // Health text with black outline
        this.ctx.font = '14px Ubuntu, sans-serif';
        const healthTextX = textX;
        const healthTextY = healthY + 15;
        this.ctx.strokeStyle = '#000000';
        this.ctx.lineWidth = 3;
        const healthText = `${this.formatNumber(Math.round(clampedHealth))}/${this.formatNumber(player.maxHealth)}`;
        this.ctx.strokeText(healthText, healthTextX, healthTextY);
        this.ctx.fillStyle = 'white';
        this.ctx.fillText(healthText, healthTextX, healthTextY);

        // Draw XP bar with rounded ends
        const xpBarY = healthY + healthBarHeight + 5;
        const xpFillWidth = (player.xp / player.xpToNextLevel) * healthBarWidth;

        // XP bar background (rounded)
        this.ctx.fillStyle = 'rgba(0, 0, 0, 1.0)';
        this.ctx.beginPath();
        this.ctx.roundRect(healthX - 2, xpBarY - 2, healthBarWidth + 4, healthBarHeight + 4, radius);
        this.ctx.fill();

        // XP bar fill (rounded) with new color
        this.ctx.fillStyle = '#faffc9';
        this.ctx.beginPath();
        this.ctx.roundRect(healthX, xpBarY, xpFillWidth, healthBarHeight, radius);
        this.ctx.fill();

        // XP text with black outline
        const xpTextX = textX;
        const xpTextY = xpBarY + 15;
        this.ctx.strokeStyle = '#000000';
        this.ctx.lineWidth = 3;
        const xpText = `LVL ${player.level} - ${this.formatNumber(player.xp)}/${this.formatNumber(player.xpToNextLevel)}`;
        this.ctx.strokeText(xpText, xpTextX, xpTextY);
        this.ctx.fillStyle = 'white';
        this.ctx.fillText(xpText, xpTextX, xpTextY);

        this.ctx.save();
        this.ctx.translate(flowerCenterX, flowerCenterY);
        // Black outline around flower
        this.ctx.beginPath();
        this.ctx.arc(0, 0, 27, 0, Math.PI * 2, false);
        this.ctx.strokeStyle = '#000000';
        this.ctx.lineWidth = 4;
        this.ctx.stroke();
        this.drawFlower({
            radius: 25,
            color: '#FFE763',
            faceFlags: 0,
            equipFlags: 0,
            eyeX: flowerEye.x,
            eyeY: flowerEye.y,
            mouth: 14.5,
        });
        this.ctx.restore();

        // Draw smaller HUDs for other squad members, stacked beneath the main HUD.
        // Uniformly scaled to 80% of the main HUD and mirrors its layout (flower + health + xp).
        const squadMemberIds: string[] = (window as any).squadMemberIds || [];
        if (squadMemberIds.length > 0) {
            const scale = 0.8;
            const smBarWidth = healthBarWidth * scale;
            const smBarHeight = healthBarHeight * scale;
            const smRadius = smBarHeight / 2;
            const smBarGap = 5 * scale;
            const smFlowerRadius = 25 * scale;
            const smFlowerOutlineRadius = 27 * scale;
            const smFlowerOutlineLineWidth = 4 * scale;
            const smFlowerInset = 12 * scale;
            const smTextInset = 35 * scale;
            const smFontSize = 14 * scale;
            const smTextLineWidth = 3 * scale;
            const smNameGap = 4;
            const smMemberGap = 12;
            const smFlowerCenterX = flowerCenterX;
            const smBarX = smFlowerCenterX + smFlowerInset;
            const smTextX = smFlowerCenterX + smTextInset;
            const smBarsHalfHeight = smBarHeight + smBarGap / 2;

            const mainHudBottom = Math.max(xpBarY + healthBarHeight, flowerCenterY + 27);
            let smBlockTopY = mainHudBottom + 10;

            for (const memberId of squadMemberIds) {
                if (memberId === socket) continue;
                const member = players.get(memberId);
                if (!member) continue;

                this.ctx.font = `${smFontSize}px Ubuntu, sans-serif`;
                const memberName = member.name || 'Squadmate';
                const nameBaselineY = smBlockTopY + smFontSize;
                this.ctx.strokeStyle = '#000000';
                this.ctx.lineWidth = smTextLineWidth;
                this.ctx.strokeText(memberName, smBarX, nameBaselineY);
                this.ctx.fillStyle = 'white';
                this.ctx.fillText(memberName, smBarX, nameBaselineY);

                const smHealthY = nameBaselineY + smNameGap;
                const smXpY = smHealthY + smBarHeight + smBarGap;
                const smFlowerCenterY = smHealthY + smBarsHalfHeight;

                // Health bar background
                this.ctx.fillStyle = 'rgba(0, 0, 0, 1.0)';
                this.ctx.beginPath();
                this.ctx.roundRect(smBarX - 2, smHealthY - 2, smBarWidth + 4, smBarHeight + 4, smRadius);
                this.ctx.fill();

                // Health bar fill
                const smClampedHealth = Math.max(0, member.health);
                const smMaxHealth = member.maxHealth > 0 ? member.maxHealth : 1;
                const smHealthFillWidth = (smClampedHealth / smMaxHealth) * smBarWidth;
                this.ctx.fillStyle = member.isInvulnerable ? '#faffc9' : '#73ff54';
                this.ctx.beginPath();
                this.ctx.roundRect(smBarX, smHealthY, smHealthFillWidth, smBarHeight, smRadius);
                this.ctx.fill();

                // Health text
                this.ctx.strokeStyle = '#000000';
                this.ctx.lineWidth = smTextLineWidth;
                const smHealthText = `${this.formatNumber(Math.round(smClampedHealth))}/${this.formatNumber(member.maxHealth)}`;
                const smHealthTextY = smHealthY + 15 * scale;
                this.ctx.strokeText(smHealthText, smTextX, smHealthTextY);
                this.ctx.fillStyle = 'white';
                this.ctx.fillText(smHealthText, smTextX, smHealthTextY);

                // XP bar background
                this.ctx.fillStyle = 'rgba(0, 0, 0, 1.0)';
                this.ctx.beginPath();
                this.ctx.roundRect(smBarX - 2, smXpY - 2, smBarWidth + 4, smBarHeight + 4, smRadius);
                this.ctx.fill();

                // XP bar fill
                const smXpDen = member.xpToNextLevel > 0 ? member.xpToNextLevel : 1;
                const smXpFillWidth = (member.xp / smXpDen) * smBarWidth;
                this.ctx.fillStyle = '#faffc9';
                this.ctx.beginPath();
                this.ctx.roundRect(smBarX, smXpY, smXpFillWidth, smBarHeight, smRadius);
                this.ctx.fill();

                // XP text
                this.ctx.strokeStyle = '#000000';
                this.ctx.lineWidth = smTextLineWidth;
                const smXpText = `LVL ${member.level} - ${this.formatNumber(member.xp)}/${this.formatNumber(member.xpToNextLevel)}`;
                const smXpTextY = smXpY + 15 * scale;
                this.ctx.strokeText(smXpText, smTextX, smXpTextY);
                this.ctx.fillStyle = 'white';
                this.ctx.fillText(smXpText, smTextX, smXpTextY);

                // Flower (uses the member's own colors/flags/mouth)
                this.ctx.save();
                this.ctx.translate(smFlowerCenterX, smFlowerCenterY);
                this.ctx.beginPath();
                this.ctx.arc(0, 0, smFlowerOutlineRadius, 0, Math.PI * 2, false);
                this.ctx.strokeStyle = '#000000';
                this.ctx.lineWidth = smFlowerOutlineLineWidth;
                this.ctx.stroke();
                this.drawFlower({
                    radius: smFlowerRadius,
                    color: member.flowerColor || '#FFE763',
                    faceFlags: member.faceFlags ?? 0,
                    equipFlags: member.equipFlags ?? 0,
                    eyeX: 2,
                    eyeY: 0,
                    mouth: member.mouth ?? 14.5,
                    thirdEyeRarity: getThirdEyeRarity(member),
                });
                this.ctx.restore();

                const smBlockBottom = Math.max(smXpY + smBarHeight, smFlowerCenterY + smFlowerOutlineRadius);
                smBlockTopY = smBlockBottom + smMemberGap;
            }
        }
    }

    // Draw floating texts
    this.drawFloatingTexts();

    // Draw minimap (hidden inside the PVP arena — that map has its own UI)
    const localPlayer = players.get(socket) as any;
    if (!localPlayer || !localPlayer.inPvpArena) {
        this.drawMinimap(players, socket);
    }
};

Graphics.prototype.drawBossBars = function(this: Graphics, enemies: Map<string, Enemy>) {
    // Calculate viewport accounting for zoom level
    const scaledWidth = this.viewW / this.zoomLevel;
    const scaledHeight = this.viewH / this.zoomLevel;
    const viewport = {
        left: this.cameraX,
        top: this.cameraY,
        right: this.cameraX + scaledWidth,
        bottom: this.cameraY + scaledHeight
    };

    // Find all super and unique mobs in view (ultras render with normal mob health bars)
    const bossMobs: Enemy[] = [];
    for (const enemy of enemies.values()) {
        if (enemy.tier === 'super' || enemy.tier === 'unique') {
            // Check if enemy is in viewport (same logic as drawGameObjects)
            const mobStats = getMobStats(enemy.type, enemy.tier);
            const baseSize = mobStats ? mobStats.size * 40 : 40;
            const visualScale = mobStats?.visual_scale ?? 1.0;
            const enemySize = baseSize * visualScale;

            // Add a buffer margin to ensure mobs are completely out before considering them out of viewport
            const cullingBuffer = Math.max(enemySize, 100); // At least 100px buffer, or enemy size if larger

            // Mob is in viewport if it's NOT completely outside (with buffer)
            if (!(enemy.x + enemySize / 2 + cullingBuffer < viewport.left ||
                  enemy.x - enemySize / 2 - cullingBuffer > viewport.right ||
                  enemy.y + enemySize / 2 + cullingBuffer < viewport.top ||
                  enemy.y - enemySize / 2 - cullingBuffer > viewport.bottom)) {
                bossMobs.push(enemy);
            }
        }
    }

    // Draw boss bars at the top of the screen
    if (bossMobs.length > 0) {
        const bossBarWidth = 400;
        const bossBarHeight = 24;
        const nameFontSize = 20;
        const nameMargin = 8; // Space between name and bar
        const bossBarSpacing = 60; // Space between multiple boss bars (increased to accommodate name)
        const topMargin = 20; // Margin from top of screen
        const centerX = this.viewW / 2;

        bossMobs.forEach((enemy, index) => {
            const nameY = topMargin + (index * bossBarSpacing);
            const bossBarY = nameY + nameFontSize + nameMargin;
            const bossBarX = centerX - bossBarWidth / 2;

            // Get mob stats for name
            const mobStats = getMobStats(enemy.type, enemy.tier);
            const mobName = mobStats ? mobStats.name : `${enemy.tier} ${enemy.type}`;

            // Draw mob name above the bar (larger font, centered)
            this.ctx.font = `${nameFontSize}px Ubuntu, sans-serif`;
            this.ctx.strokeStyle = '#000000';
            this.ctx.lineWidth = 4;
            const nameTextWidth = this.ctx.measureText(mobName).width;
            const nameX = centerX - nameTextWidth / 2;
            this.ctx.strokeText(mobName, nameX, nameY);
            this.ctx.fillStyle = 'white';
            this.ctx.fillText(mobName, nameX, nameY);

            // Draw health bar with rounded ends
            const clampedHealth = Math.max(0, enemy.health);
            const healthFillWidth = (clampedHealth / enemy.maxHealth) * bossBarWidth;
            const radius = bossBarHeight / 2;

            // Boss bar background (rounded)
            this.ctx.fillStyle = 'rgba(0, 0, 0, 1.0)';
            this.ctx.beginPath();
            this.ctx.roundRect(bossBarX - 2, bossBarY - 2, bossBarWidth + 4, bossBarHeight + 4, radius);
            this.ctx.fill();

            // Boss bar fill (rounded) - same color as player health bar
            this.ctx.fillStyle = '#73ff54';
            this.ctx.beginPath();
            this.ctx.roundRect(bossBarX, bossBarY, healthFillWidth, bossBarHeight, radius);
            this.ctx.fill();

            // Draw health text (centered on the bar)
            this.ctx.font = '16px Ubuntu, sans-serif';
            const textY = bossBarY + 18;
            const healthText = `${this.formatNumber(Math.round(clampedHealth))}/${this.formatNumber(enemy.maxHealth)}`;
            const healthTextWidth = this.ctx.measureText(healthText).width;
            const healthTextX = centerX - healthTextWidth / 2;
            this.ctx.strokeStyle = '#000000';
            this.ctx.lineWidth = 3;
            this.ctx.strokeText(healthText, healthTextX, textY);
            this.ctx.fillStyle = 'white';
            this.ctx.fillText(healthText, healthTextX, textY);
        });
    }
};

Graphics.prototype.formatNumber = function(this: Graphics, num: number): string {
    if (this.showRarityGlow) {
        return String(Math.round(num));
    }
    if (num >= 1e12) {
        return (num / 1e12).toFixed(1) + 'T';
    } else if (num >= 1e9) {
        return (num / 1e9).toFixed(1) + 'B';
    } else if (num >= 1e6) {
        return (num / 1e6).toFixed(1) + 'M';
    } else if (num >= 1e3) {
        return (num / 1e3).toFixed(1) + 'K';
    } else {
        return String(Math.round(num));
    }
};

Graphics.prototype.drawCorpse = function(this: Graphics, x: number, y: number, angle: number, player?: Player) {
    this.ctx.save();
    this.ctx.translate(x, y);
    this.ctx.rotate(angle);

    this.drawFlower({
        radius: 25,
        color: player?.flowerColor || '#FFE763',
        faceFlags: FaceFlags.DeadEyes,
        equipFlags: player?.equipFlags || 0,
        eyeX: 0,
        eyeY: 0,
        mouth: 15, // Sad mouth (curve goes down)
        thirdEyeRarity: player ? getThirdEyeRarity(player) : undefined,
    });

    this.ctx.restore();
};

Graphics.prototype.setShowConsoleLogs = function(this: Graphics, enabled: boolean): void {
    if (enabled && !this.showConsoleLogs_) {
        this.showConsoleLogs_ = true;
        this.originalConsoleLog = console.log.bind(console);
        this.originalConsoleWarn = console.warn.bind(console);
        this.originalConsoleError = console.error.bind(console);

        console.log = (...args: any[]) => {
            this.addConsoleLog(args, '#ffffff');
            this.originalConsoleLog!(...args);
        };
        console.warn = (...args: any[]) => {
            this.addConsoleLog(args, '#ffdd57');
            this.originalConsoleWarn!(...args);
        };
        console.error = (...args: any[]) => {
            this.addConsoleLog(args, '#ff4444');
            this.originalConsoleError!(...args);
        };
    } else if (!enabled && this.showConsoleLogs_) {
        this.showConsoleLogs_ = false;
        if (this.originalConsoleLog) {
            console.log = this.originalConsoleLog;
            console.warn = this.originalConsoleWarn!;
            console.error = this.originalConsoleError!;
            this.originalConsoleLog = null;
            this.originalConsoleWarn = null;
            this.originalConsoleError = null;
        }
        this.consoleLogs = [];
    }
};

Graphics.prototype.addConsoleLog = function(this: Graphics, args: any[], color: string): void {
    const text = args.map(a => {
        if (typeof a === 'object') {
            try { return JSON.stringify(a); } catch { return String(a); }
        }
        return String(a);
    }).join(' ');

    this.consoleLogs.push({ text, color, timestamp: Date.now() });
    if (this.consoleLogs.length > this.MAX_CONSOLE_LOGS) {
        this.consoleLogs.shift();
    }
};

Graphics.prototype.drawConsoleLogs = function(this: Graphics): void {
    if (!this.showConsoleLogs_ || this.consoleLogs.length === 0) return;

    const now = Date.now();
    // Remove expired logs
    this.consoleLogs = this.consoleLogs.filter(log => now - log.timestamp < this.CONSOLE_LOG_LIFETIME);
    if (this.consoleLogs.length === 0) return;

    const ctx = this.ctx;
    const lineHeight = 16;
    const padding = 8;
    const x = padding;
    const maxWidth = Math.min(600, this.viewW * 0.4);
    const totalHeight = this.consoleLogs.length * lineHeight + padding * 2;
    const y = this.viewH - totalHeight - padding;

    // Draw background
    ctx.save();
    // Draw log lines
    ctx.font = '12px monospace';
    ctx.textBaseline = 'top';
    for (let i = 0; i < this.consoleLogs.length; i++) {
        const log = this.consoleLogs[i];
        const age = now - log.timestamp;
        const fadeStart = this.CONSOLE_LOG_LIFETIME * 0.7;
        const alpha = age > fadeStart ? 1 - (age - fadeStart) / (this.CONSOLE_LOG_LIFETIME - fadeStart) : 1;

        ctx.globalAlpha = alpha;
        ctx.fillStyle = log.color;

        // Truncate text to fit
        let displayText = log.text;
        while (ctx.measureText(displayText).width > maxWidth - padding * 2 && displayText.length > 0) {
            displayText = displayText.slice(0, -4) + '...';
        }

        ctx.fillText(displayText, x + padding, y + padding + i * lineHeight);
    }
    ctx.restore();
};

Graphics.prototype.showDeathScreen = function(this: Graphics, killedBy?: { type: string; tier: string }): void {
    this.deathScreenVisible = true;
    if (killedBy) {
        const capType = killedBy.type.charAt(0).toUpperCase() + killedBy.type.slice(1);
        const capTier = killedBy.tier.charAt(0).toUpperCase() + killedBy.tier.slice(1);
        this.deathScreenKilledBy = `${capTier} ${capType}`;
    } else {
        this.deathScreenKilledBy = 'A mysterious entity';
    }
};

Graphics.prototype.hideDeathScreen = function(this: Graphics): void {
    this.deathScreenVisible = false;
    this.deathScreenButtonHovered = false;
    this.deathScreenCloseHovered = false;
};

Graphics.prototype.drawDeathScreen = function(this: Graphics): void {
    if (!this.deathScreenVisible) return;

    const ctx = this.ctx;
    const w = this.viewW;
    const h = this.viewH;

    ctx.save();

    // Semi-transparent dark overlay
    ctx.fillStyle = 'rgba(0, 0, 0, 0.65)';
    ctx.fillRect(0, 0, w, h);

    const centerX = w / 2;
    const centerY = h / 2;

    // "You Died!" title
    ctx.font = 'bold 48px Ubuntu, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 5;
    ctx.strokeText('You Died!', centerX, centerY - 60);
    ctx.fillStyle = '#ff4444';
    ctx.fillText('You Died!', centerX, centerY - 60);

    // Killed-by message
    ctx.font = '22px Ubuntu, sans-serif';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 3;
    const killedText = `You were destroyed by: ${this.deathScreenKilledBy}`;
    ctx.strokeText(killedText, centerX, centerY - 10);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(killedText, centerX, centerY - 10);

    // "Continue" button
    const btnW = 200;
    const btnH = 50;
    const btnX = centerX - btnW / 2;
    const btnY = centerY + 30;
    const btnRadius = 10;

    // Store button rect for hit testing
    this.deathScreenButtonRect = { x: btnX, y: btnY, w: btnW, h: btnH };

    // Button background
    ctx.fillStyle = this.deathScreenButtonHovered ? '#5a9e4a' : '#4a8e3a';
    ctx.beginPath();
    ctx.roundRect(btnX, btnY, btnW, btnH, btnRadius);
    ctx.fill();

    // Button border
    ctx.strokeStyle = '#2d5a22';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Button text
    ctx.font = 'bold 22px Ubuntu, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 3;
    ctx.strokeText('Continue', centerX, btnY + btnH / 2);
    ctx.fillText('Continue', centerX, btnY + btnH / 2);

    // "Close" button
    const closeBtnW = 140;
    const closeBtnH = 36;
    const closeBtnX = centerX - closeBtnW / 2;
    const closeBtnY = btnY + btnH + 15;

    this.deathScreenCloseRect = { x: closeBtnX, y: closeBtnY, w: closeBtnW, h: closeBtnH };

    ctx.fillStyle = this.deathScreenCloseHovered ? '#777777' : '#666666';
    ctx.beginPath();
    ctx.roundRect(closeBtnX, closeBtnY, closeBtnW, closeBtnH, btnRadius);
    ctx.fill();

    ctx.strokeStyle = '#444444';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.font = 'bold 16px Ubuntu, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 3;
    ctx.strokeText('Close', centerX, closeBtnY + closeBtnH / 2);
    ctx.fillText('Close', centerX, closeBtnY + closeBtnH / 2);

    // Hint text
    ctx.font = '14px Ubuntu, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.lineWidth = 0;
    ctx.fillText('Press ENTER to continue', centerX, closeBtnY + closeBtnH + 25);

    ctx.restore();
};
