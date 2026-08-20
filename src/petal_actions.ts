import { getRarityIndex, getEffectivePetalCooldown } from './petals';
import { ServerPlayer } from './player';
import { sanitizePlayerForClient } from './server/playerWire';
import { Item } from './item';
import { Enemy, isCentipedeHeadType, isCentipedeBodyType } from './server_utils';
import { addXPToPlayer, handleMobDrops, updateSpecialMobCounts, sendBossMobDefeatedMessage } from './server';
import { spawnEnemy, removeEnemyAt } from './server/enemyRegistry';
import { killEnemy, type KillContext } from './server/shared/killHandler';
import { players, enemies } from './constants';
import { database } from './database';
import { playerUserIds } from './server/gameState';
import { getMobStats, getAllMobTypes } from './mobs';
import { spawnCentipedeBodySegments } from './server/enemySpawner';
import { emitPetalRestored, emitPetalBroken } from './server/petalEvents';

// Action execution context
export interface ActionContext {
    player: ServerPlayer;
    petalX: number;
    petalY: number;
    petalSize: number;
    petalDamage: number; // Add petal damage for rarity scaling
    enemies: Enemy[];
    io: any; // Socket.IO instance
    petalId?: string; // Unique ID for the petal instance
    loadoutIndex?: number; // Index in player loadout
    instanceIndex?: number; // Instance index for multi-count petals
}

/**
 * Build a kill context for the partial death handlers in explodePetal /
 * strikeLightning. Those paths never call trackMobKill or cleanupEnemy
 * (trackMobKillTiming: 'none', skipCleanup: true), so those two ctx fields
 * are stubbed. `database` and `playerUserIds` are NOT stubbable, though:
 * killEnemy's credited-player branch reads them (via
 * getLeaderboardRewardMultipliers) to grant the leaderboard reward tiers, so
 * they must be the real live references.
 */
function makePetalKillCtx(io: any): KillContext {
    return {
        io,
        players,
        playerUserIds,
        database,
        removeEnemyAt,
        // Stubs — only reachable when trackMobKillTiming !== 'none', which
        // explodePetal/strikeLightning never pass.
        savePlayerProgress: undefined!,
        trackMobKill: undefined!,
        cleanupEnemy: undefined!,
        // Real deps:
        addXPToPlayer,
        handleMobDrops,
        sendBossMobDefeatedMessage,
        updateSpecialMobCounts,
    };
}



// Player effect tracking
export interface PlayerEffect {
    type: 'damage_boost' | 'speed_boost' | 'shield';
    value: number;
    duration: number;
    startTime: number;
}

// Global state for tracking petal actions


// Track split players: originalPlayerId -> { player1: ServerPlayer, player2: ServerPlayer, activeIndex: 0|1 }
interface SplitPlayerState {
    player1: ServerPlayer;
    player2: ServerPlayer;
    activeIndex: 0 | 1; // 0 = player1, 1 = player2
    originalId: string; // Original player ID
}
export const splitPlayers: Map<string, SplitPlayerState> = new Map();

// Track which petals have already executed split_player to prevent re-execution
const splitExecutedPetalIds: Set<string> = new Set();

// Explosion throttle state
let lastExplosionTime: number = 0;
const EXPLOSION_THROTTLE_MS: number = 20;

// Lightning rate limiter for lightning_cutter (2 per second = 500ms minimum between strikes)
const lightningCutterStrikeTimes: Map<string, number[]> = new Map(); // playerId -> array of strike times
const LIGHTNING_CUTTER_RATE_LIMIT_MS: number = 500; // Minimum 500ms between strikes (2 per second)
const LIGHTNING_CUTTER_MAX_STRIKES: number = 2; // Maximum 2 strikes per second



// Skill multipliers based on rarity tier
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

function getSkillMultiplier(skillTier: string | undefined): number {
    if (!skillTier) return 1.0;
    return SKILL_MULTIPLIERS[skillTier] || 1.0;
}

// Heal the player
function healPlayer(player: ServerPlayer, healAmount: number, io: any, context?: ActionContext): void {
    const oldHealth = player.health;
    
    // Apply rarity scaling (sqrt(3) per rarity level)
    let rarityMultiplier = 1.0;
    if (context && context.loadoutIndex !== undefined) {
        const petal = player.loadout[context.loadoutIndex];
        if (petal && petal.type === 'petal' && petal.rarity) {
            const rarityIndex = getRarityIndex(petal.rarity);
            if (rarityIndex >= 0) {
                rarityMultiplier = Math.pow(Math.sqrt(3), rarityIndex);
            }
        }
    }
    
    // Apply healing multiplier skill bonus
    const healingMultiplier = getSkillMultiplier(player.skills?.healingMultiplier);
    const modifiedHealAmount = healAmount * rarityMultiplier * healingMultiplier * 3;
    player.health = Math.min(player.maxHealth, player.health + modifiedHealAmount);
    
    if (player.health !== oldHealth) {
        io.emit('playerHealed', { 
            playerId: player.id, 
            health: player.health,
            healAmount: player.health - oldHealth
        });
    }
}

function applyPlayerEffect(player: ServerPlayer, type: PlayerEffect['type'], value: number, duration: number): void {
    if (!player.effects) player.effects = [];
    player.effects = player.effects.filter(e => e.type !== type);
    player.effects.push({ type, value, duration, startTime: Date.now() });
}

/**
 * Grant (or refresh) a temporary shield on a flower. Shell's burst shield uses
 * this; effects of a given type don't stack (applyPlayerEffect replaces), which
 * matches gardn where a fresh shell overwrites rather than adds.
 */
export function grantShield(player: ServerPlayer, amount: number, durationMs: number): void {
    applyPlayerEffect(player, 'shield', amount, durationMs);
}

// Explode petal and deal area damage
function explodePetal(x: number, y: number, petalSize: number, damage: number, enemies: Enemy[], io: any, player?: ServerPlayer): void {
    // Throttle explosions to 1 per 20ms
    const currentTime = Date.now();
    if (currentTime - lastExplosionTime < EXPLOSION_THROTTLE_MS) {
        return;
    }
    lastExplosionTime = currentTime;
    
    const explosionRadius = petalSize * 40 * 3; // Convert petal size to pixels and make explosion 3x larger
    
    // Process enemies in reverse order to avoid index issues when removing
    for (let i = enemies.length - 1; i >= 0; i--) {
        const enemy = enemies[i];
        
        // Skip all pets (pets should not be damaged by any player's explosions)
        if (enemy.ownerId) {
            continue;
        }
        
        const distance = Math.sqrt((enemy.x - x) ** 2 + (enemy.y - y) ** 2);
        
        if (distance <= explosionRadius) {
            // Track damage if player is provided
            if (player) {
                const { trackDamage } = require('./server');
                trackDamage(enemy, player.id, damage);
            }
            
            enemy.health = Math.max(0, enemy.health - damage);
            
            // Apply knockback
            const knockbackForce = 20;
            const dx = enemy.x - x;
            const dy = enemy.y - y;
            const normalizedDx = dx / (distance || 1);
            const normalizedDy = dy / (distance || 1);
            
            enemy.knockbackX = normalizedDx * knockbackForce;
            enemy.knockbackY = normalizedDy * knockbackForce;
            
            io.emit('enemyDamaged', { enemyId: enemy.id, health: enemy.health });
            
            // Check if enemy dies
            if (enemy.health <= 0) {
                // Explode/lightning never ran cleanupEnemy or trackMobKill
                // historically (skipCleanup + timing 'none' preserve that).
                killEnemy(enemy, i, enemies, makePetalKillCtx(io), {
                    killerPlayerId: player?.id,
                    skipCleanup: true,
                    trackMobKillTiming: 'none',
                });
            }
        }
    }

    // Emit explosion effect to clients
    io.emit('petalExplosion', {
        x: x,
        y: y,
        radius: explosionRadius,
        damage: damage
    });
}

// Check if lightning strike is allowed for lightning_cutter (rate limit: 2 per second)
function canStrikeLightning(player: ServerPlayer | undefined, context?: ActionContext): boolean {
    if (!player) return true; // Allow if no player (shouldn't happen but be safe)
    
    // Check if this is from a lightning_cutter petal
    let isLightningCutter = false;
    if (context && context.loadoutIndex !== undefined) {
        const petal = player.loadout[context.loadoutIndex];
        if (petal && petal.type === 'petal' && petal.petalType === 'lightning_cutter') {
            isLightningCutter = true;
        }
    }
    
    // Only apply rate limit to lightning_cutter
    if (!isLightningCutter) return true;
    
    const currentTime = Date.now();
    let playerStrikes = lightningCutterStrikeTimes.get(player.id) || [];
    
    // Remove strikes older than 1 second
    playerStrikes = playerStrikes.filter(time => currentTime - time < 1000);
    
    // Check if we've already hit the max strikes per second
    if (playerStrikes.length >= LIGHTNING_CUTTER_MAX_STRIKES) {
        return false; // Rate limit exceeded (already 2 strikes in the last second)
    }
    
    // Check minimum time between strikes (500ms)
    if (playerStrikes.length > 0) {
        const lastStrike = playerStrikes[playerStrikes.length - 1];
        if (currentTime - lastStrike < LIGHTNING_CUTTER_RATE_LIMIT_MS) {
            return false; // Too soon since last strike
        }
    }
    
    // Update strike times
    playerStrikes.push(currentTime);
    lightningCutterStrikeTimes.set(player.id, playerStrikes);
    
    return true;
}

// Strike lightning and deal damage to multiple targets in radius
function strikeLightning(x: number, y: number, radius: number, enemies: Enemy[], io: any, player?: ServerPlayer, petalDamage?: number, context?: ActionContext): void {
    // Check rate limit for lightning_cutter
    if (!canStrikeLightning(player, context)) {
        return; // Rate limit exceeded, skip this lightning strike
    }
    
    const targets: { x: number; y: number; enemyId: string }[] = [];
    
    // Find all enemies within the lightning radius
    for (let i = enemies.length - 1; i >= 0; i--) {
        const enemy = enemies[i];
        
        // Skip all pets (pets should not be damaged by any player's lightning)
        if (enemy.ownerId) {
            continue;
        }
        
        const distance = Math.sqrt((enemy.x - x) ** 2 + (enemy.y - y) ** 2);
        
        if (distance <= radius) {
            targets.push({
                x: enemy.x,
                y: enemy.y,
                enemyId: enemy.id
            });
            
            // Deal damage to the enemy - use petal damage for rarity scaling
            const damage = petalDamage || 25; // Use petal damage if available, fallback to 25
            
            // Track damage if player is provided
            if (player) {
                const { trackDamage } = require('./server');
                trackDamage(enemy, player.id, damage);
            }
            
            enemy.health = Math.max(0, enemy.health - damage);
            
            io.emit('enemyDamaged', { enemyId: enemy.id, health: enemy.health });
            
            // Check if enemy dies
            if (enemy.health <= 0) {
                killEnemy(enemy, i, enemies, makePetalKillCtx(io), {
                    killerPlayerId: player?.id,
                    skipCleanup: true,
                    trackMobKillTiming: 'none',
                });
            }
        }
    }

    // Emit lightning effect to clients
    io.emit('lightningStrike', {
        x: x,
        y: y,
        targets: targets,
        damage: petalDamage || 25
    });
}

// Helper function to find a player's pet by mob type
function findPlayerPetByMobType(ownerId: string, mobType: string): Enemy | undefined {
    return enemies.find(enemy => 
        enemy.ownerId === ownerId && 
        enemy.type === mobType
    );
}

// Helper function to despawn a pet
export function despawnPet(pet: Enemy, io: any): void {
    // For centipede pets, drop the whole chain — otherwise the first orphaned
    // body segment would auto-promote into a new free-roaming head.
    if (isCentipedeHeadType(pet.type)) {
        for (let i = enemies.length - 1; i >= 0; i--) {
            const e = enemies[i];
            if (e.id === pet.id || (isCentipedeBodyType(e.type) && e.headId === pet.id)) {
                removeEnemyAt(i);
                io.emit('enemyDestroyed', e.id);
            }
        }
        return;
    }

    const index = enemies.findIndex(e => e.id === pet.id);
    if (index !== -1) {
        removeEnemyAt(index);
        io.emit('enemyDestroyed', pet.id);
        // console.log(`Despawned pet ${pet.tier} ${pet.type} for player ${pet.ownerId}`);
    }
}

// Despawn all pets owned by a player
export function despawnAllPlayerPets(playerId: string, io: any): void {
    for (let i = enemies.length - 1; i >= 0; i--) {
        if (enemies[i].ownerId === playerId) {
            io.emit('enemyDestroyed', enemies[i].id);
            removeEnemyAt(i);
        }
    }
}

// See the cap check in spawnPet. Counts entities (centipede segments included),
// not eggs: a full loadout of ordinary eggs stays far below this.
const MAX_PET_ENTITIES_PER_PLAYER = 50;

/**
 * Per-mob stat multipliers applied when a mob is summoned as a pet, on top of
 * its normal rarity scaling. The digger's wild stat line (1000 hp / 25 damage
 * at common, hostile, fast) is tuned for a mob that only crawls out of a dying
 * ant hole; handed to a player as a permanent escort it outclasses every other
 * egg at the same rarity, so a digger egg summons a half-strength one.
 */
const PET_STAT_MULTIPLIERS: { [mobType: string]: { health: number; damage: number } } = {
    digger: { health: 0.5, damage: 0.5 },
};

// Spawn a pet mob that belongs to a player
export function spawnPet(mobType: string, rarity: string, x: number, y: number, ownerId: string, io: any, skipDuplicateCheck: boolean = false, count: number = 1): void {
    // Petals that summon a squad (stick -> two sandstorms). The duplicate check
    // runs once for the whole squad, otherwise each summon would despawn the
    // previous one and only the last would survive.
    if (count > 1) {
        if (!skipDuplicateCheck) {
            for (let i = enemies.length - 1; i >= 0; i--) {
                if (enemies[i].ownerId === ownerId && enemies[i].type === mobType) {
                    despawnPet(enemies[i], io);
                }
            }
        }
        for (let i = 0; i < count; i++) {
            spawnPet(mobType, rarity, x, y, ownerId, io, true, 1);
        }
        return;
    }

    // Validate mob type
    const allMobTypes = getAllMobTypes();
    if (!allMobTypes.includes(mobType)) {
        console.log(`Invalid mob type for pet: ${mobType}`);
        return;
    }

    // Validate rarity
    const validRarities = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'ultra', 'super', 'unique', 'apex'];
    if (!validRarities.includes(rarity.toLowerCase())) {
        console.log(`Invalid rarity for pet: ${rarity}`);
        return;
    }

    // Apex eggs spawn 3 unique pets instead of a single apex pet
    if (rarity.toLowerCase() === 'apex') {
        for (let i = enemies.length - 1; i >= 0; i--) {
            if (enemies[i].ownerId === ownerId && enemies[i].type === mobType) {
                despawnPet(enemies[i], io);
            }
        }
        for (let i = 0; i < 3; i++) {
            spawnPet(mobType, 'unique', x, y, ownerId, io, true);
        }
        return;
    }

    // Check if player already has a pet of this mob type - despawn it first
    if (!skipDuplicateCheck) {
        const existingPet = findPlayerPetByMobType(ownerId, mobType);
        if (existingPet) {
            // console.log(`[PET] Player ${ownerId} already has a ${mobType} pet, despawning old one`);
            despawnPet(existingPet, io);
        }
    }

    // Hard cap on live pet entities per player, counting centipede body
    // segments. 10 egg slots × apex (3 pets each) × centipede pets (10
    // entities each) could otherwise put hundreds of entities in the world
    // per player, and several players doing that together stalled the tick
    // loop until nginx answered 502. The cap sits far above any normal
    // loadout, so it only bites deliberate stacking.
    let ownedEntities = 0;
    for (const e of enemies) {
        if (e.ownerId === ownerId) ownedEntities++;
    }
    if (ownedEntities >= MAX_PET_ENTITIES_PER_PLAYER) {
        console.log(`[PET] Player ${ownerId} is at the pet entity cap (${MAX_PET_ENTITIES_PER_PLAYER}); not spawning ${mobType}`);
        return;
    }

    const tier = rarity.toLowerCase() as Enemy['tier'];
    const mobStats = getMobStats(mobType, tier);
    
    if (!mobStats) {
        console.log(`No stats found for pet ${mobType} with rarity ${tier}`);
        return;
    }

    // Calculate range bonus: +200 per rarity level
    const rarityIndex = getRarityIndex(rarity.toLowerCase());
    const rangeBonus = rarityIndex >= 0 ? rarityIndex * 200 : 0;
    const petRange = (mobStats.range || 0) + rangeBonus;

    // Pet-only stat nerfs (see PET_STAT_MULTIPLIERS). maxHealth is what the
    // client's health bar divides by, and encodeEnemyDelta only puts maxHealth
    // on the wire when it differs from the mob config's, so this reaches the
    // client on its own.
    //
    // Passed INTO the spawn rather than patched on after it: `damage` is written
    // to the ECS once, at construction, and never re-synced — a nerf applied
    // afterwards would leave ECS-owned pet melee hitting for the full wild
    // value while the legacy object read the nerfed one.
    const statMods = PET_STAT_MULTIPLIERS[mobType];

    // Create the pet enemy (ECS entity + enemies[] admission, atomically)
    const pet = spawnEnemy(mobType, tier, x, y, {
        aiType: 'passive', // Pets are not hostile to players
        range: petRange,
        ownerId, // Set the owner
        petImage: mobStats.petImage, // Use pet image if available
        maxHealth: statMods ? mobStats.health * statMods.health : undefined,
        damage: statMods ? mobStats.damage * statMods.damage : undefined,
    })!; // mobStats validated above

    // Notify all clients
    io.emit('enemySpawned', pet);

    // Centipede pets need their trailing body chain too, with ownerId propagated
    // to each segment so they follow the owner alongside the head.
    if (isCentipedeHeadType(mobType)) {
        const beforeCount = enemies.length;
        spawnCentipedeBodySegments(pet);
        for (let i = beforeCount; i < enemies.length; i++) {
            io.emit('enemySpawned', enemies[i]);
        }
    }

    // console.log(`Spawned pet ${tier} ${mobType} for player ${ownerId} at (${Math.round(x)}, ${Math.round(y)})`);
}

// Mark petal for breaking
function markPetalForBreak(petalId: string, context: ActionContext): void {
    const { player, loadoutIndex, io } = context;
    if (loadoutIndex !== undefined && player.loadout[loadoutIndex]) {
        const petal = player.loadout[loadoutIndex];
        if (!petal) return;
        
        // Set health to 0
        petal.health = 0;
        
        // Mark as on cooldown
        petal.onCooldown = true;
        
        // Store original petal data for restoration
        const originalPetal = {
            type: petal.type,
            petalType: petal.petalType,
            rarity: petal.rarity,
            maxHealth: petal.maxHealth
        };
        
        // Emit petal broken event to clients
        emitPetalBroken(io, player.id, {
            playerId: player.id,
            loadoutIndex: loadoutIndex,
            petalType: petal.petalType
        }, player.x, player.y);
        
        // Get cooldown time from petal stats
        const cooldownTime = getEffectivePetalCooldown(petal.petalType, petal.rarity);
        // Deadline for the tick-loop restore backstop in playerState — a break
        // with no stamp gets restored on the next tick instead of reloading.
        petal.cooldownEndTime = Date.now() + cooldownTime;

        // Schedule petal restoration.
        // Snapshot identity so a stale timer doesn't clobber a swapped slot.
        const snapshotPetalType = originalPetal.petalType;
        const snapshotRarity = originalPetal.rarity;
        setTimeout(() => {
            const current = player.loadout[loadoutIndex];
            if (!current || !current.onCooldown) return;
            if (current.type !== 'petal' ||
                current.petalType !== snapshotPetalType ||
                current.rarity !== snapshotRarity) return;
            // Restore petal after cooldown
            player.loadout[loadoutIndex] = {
                ...originalPetal,
                health: originalPetal.maxHealth,
                onCooldown: false
            };

            // Emit restoration event
            emitPetalRestored(io, player.id, {
                playerId: player.id,
                loadoutIndex: loadoutIndex,
                petal: player.loadout[loadoutIndex]
            });

            // Clean up behaviour state, which re-arms a one-shot effect.
            cleanupPetalBehaviour(petalId);
        }, cooldownTime);
        
        // The instance stops running until the restore above re-arms it.
        petalBehaviourStates.delete(petalId);
    }
}

// ---------------------------------------------------------------------------
// Petal behaviours
// ---------------------------------------------------------------------------
/**
 * What petals with special behaviour actually do, as TypeScript.
 *
 * This replaces a string interpreter: petal configs carried an `actions` script
 * ("wait_until_collision; explode 30; break;") which was parsed on every call
 * into a 40-opcode instruction list and stepped ONE INSTRUCTION PER TICK by a
 * per-instance state machine with an if-stack, a loop-stack, a label map, a
 * goto, and a global memory dictionary. Ten petals used it. Between them they
 * used seven opcodes, no loops, no labels, no goto, and one memory read.
 *
 * ---------------------------------------------------------------------------
 * The triggers, and why there are four
 * ---------------------------------------------------------------------------
 * The interpreter had two entry points with DIFFERENT semantics, and the
 * difference was load-bearing, so it is reproduced rather than unified:
 *
 *   SPAWN   ran the real program: control flow worked, `delay`/`restart` gave
 *           a repeating effect, `wait_until_collision` parked the instance.
 *   BREAK   ran the same script in "immediate mode", where every control-flow
 *           opcode was silently skipped. So a breaking petal fired its effect
 *           opcodes UNCONDITIONALLY and in order — an `if` guard did not apply,
 *           a `wait_until_collision` did not park, and `delay`/`restart` did
 *           nothing. Every scripted petal therefore has a break effect, whether
 *           its script looks like it should or not.
 *
 * Hence: `onSpawn` (one-shot, guards apply), `onCollision` (the parked case),
 * `onInterval` (the `delay`/`restart` case) and `onBreak` (immediate mode).
 *
 * ---------------------------------------------------------------------------
 * Two preserved quirks
 * ---------------------------------------------------------------------------
 *  1. blood_leaf's script ends `heal -1` with NO semicolon, so the parser (which
 *     split on `;`) fed `parseFloat` the string "-1\nset_memory ..." — that
 *     yields -1 and swallowed the rest of the line. Its `set_memory` never ran,
 *     and nothing ever read the cell it would have written. Not reinstated.
 *  2. The break-time unconditional firing described above. It looks like a bug
 *     for starfish (`if health < 75; heal 25; endif` heals on break regardless
 *     of health) but it is what shipped, and changing it is a balance decision.
 *
 * Timing note: the interpreter spent one tick per instruction, so a
 * `delay 10000; restart` cycle actually came round every 10000ms plus two ticks
 * (~67ms). The interval below is a clean 10000ms. That 0.7% difference is not
 * observable and is not worth reproducing a program counter for.
 */
interface PetalBehaviour {
    /** Fired once per instance, when it is first built. Guards apply here. */
    onSpawn?: (context: ActionContext) => void;
    /** True when the instance parks at spawn until it hits something. */
    waitsForCollision?: boolean;
    /** Fired when a parked instance collides. */
    onCollision?: (context: ActionContext) => void;
    /** Period for a repeating effect, from the script's `delay N; restart`. */
    intervalMs?: number;
    /** Fired every `intervalMs` after the spawn effect. */
    onInterval?: (context: ActionContext) => void;
    /** Fired when the petal breaks — unconditional, see "immediate mode" above. */
    onBreak?: (context: ActionContext) => void;
}

/** `if memory:player:extended == 1` — petals held out rather than orbiting. */
function petalsExtended(player: ServerPlayer): boolean {
    return (player.inputs?.petalExtension || 1.0) > 1.0;
}

const strike1000 = (c: ActionContext) =>
    strikeLightning(c.petalX, c.petalY, 1000, c.enemies, c.io, c.player, c.petalDamage, c);
const explode = (damage: number) => (c: ActionContext) =>
    explodePetal(c.petalX, c.petalY, c.petalSize, damage, c.enemies, c.io, c.player);
const heal = (amount: number) => (c: ActionContext) =>
    healPlayer(c.player, amount, c.io, c);
const breakSelf = (c: ActionContext) => {
    if (c.petalId) markPetalForBreak(c.petalId, c);
};

/**
 * Petal type -> behaviour. The scripts each entry replaces are quoted so the
 * two can be diffed by eye; the `actions` field they came from is gone.
 */
export const PETAL_BEHAVIOURS: Record<string, PetalBehaviour> = {
    // `wait_until_collision; lightning 1000;`
    lightning: {
        waitsForCollision: true,
        onCollision: strike1000,
        onBreak: strike1000,
    },

    // `lightning 1000; break;`
    lightning_cutter: {
        onSpawn: (c) => { strike1000(c); breakSelf(c); },
        // `break` does nothing in immediate mode; only the strike replays.
        onBreak: strike1000,
    },

    // `if memory:player:extended == 1; explode 100; heal -1; endif;`
    blood_leaf: {
        onSpawn: (c) => {
            if (!petalsExtended(c.player)) return;
            explode(100)(c);
            heal(-1)(c);
        },
        onBreak: (c) => { explode(100)(c); heal(-1)(c); },
    },

    // `if memory:player:health < 75; heal 25; endif;`
    starfish: {
        onSpawn: (c) => { if (c.player.health < 75) heal(25)(c); },
        // Unguarded on break — quirk (2).
        onBreak: heal(25),
    },

    // `wait_until_collision; explode 30; break;`
    bomb: {
        waitsForCollision: true,
        onCollision: (c) => { explode(30)(c); breakSelf(c); },
        onBreak: explode(30),
    },

    // `shield 50 10000; delay 10000; restart;`
    shield: {
        onSpawn: (c) => applyPlayerEffect(c.player, 'shield', 50, 10000),
        intervalMs: 10000,
        onInterval: (c) => applyPlayerEffect(c.player, 'shield', 50, 10000),
        onBreak: (c) => applyPlayerEffect(c.player, 'shield', 50, 10000),
    },

    // --- test petals (not obtainable in normal play) ----------------------
    // `heal 20; delay 2000; restart;`
    healing: {
        onSpawn: heal(20),
        intervalMs: 2000,
        onInterval: heal(20),
        onBreak: heal(20),
    },
    // `wait_until_collision; explode 30; break;`
    explosive: {
        waitsForCollision: true,
        onCollision: (c) => { explode(30)(c); breakSelf(c); },
        onBreak: explode(30),
    },
    // `explode 50; delay 3000; restart;`
    test_explosive: {
        onSpawn: explode(50),
        intervalMs: 3000,
        onInterval: explode(50),
        onBreak: explode(50),
    },
    // NOTE: `action_test` had no behaviour of its own — its script exercised
    // interpreter features (goto, loops, memory cells, nested ifs) that had no
    // gameplay meaning. With the interpreter gone the petal has nothing to test,
    // so it is left with no behaviour rather than given a fabricated one.
};

/** Whether this petal type runs anything at all. */
export function hasPetalBehaviour(petalType: string | undefined): boolean {
    return petalType !== undefined
        && Object.prototype.hasOwnProperty.call(PETAL_BEHAVIOURS, petalType);
}

/**
 * Live per-instance state. Replaces `petalActionStates`.
 *
 * Keyed by the same `${playerId}_${loadoutIndex}_${instanceIndex}` id the
 * interpreter used, and cleared from the same place — the petal-restore timer
 * after a break — which is what re-arms a one-shot effect each cooldown cycle.
 */
interface PetalBehaviourState {
    petalType: string;
    context: ActionContext;
    waitingForCollision: boolean;
    /** Absolute ms of the next periodic fire; 0 when the petal has no interval. */
    nextFireAt: number;
}
const petalBehaviourStates: Map<string, PetalBehaviourState> = new Map();

/**
 * Arm (or refresh) an instance's behaviour. Called every tick while the petal
 * exists, exactly as `executePetalActionsOnSpawn` was.
 *
 * The refresh matters: the context carries the petal's LIVE position, and the
 * interval effects below fire from wherever the petal currently is. First call
 * runs the spawn effect; later calls only update the context.
 */
export function armPetalBehaviour(petalType: string | undefined, context: ActionContext): void {
    if (petalType === undefined || !context.petalId) return;
    const behaviour = PETAL_BEHAVIOURS[petalType];
    if (behaviour === undefined) return;

    const existing = petalBehaviourStates.get(context.petalId);
    if (existing !== undefined) {
        existing.context = context;
        return;
    }

    petalBehaviourStates.set(context.petalId, {
        petalType,
        context,
        waitingForCollision: !!behaviour.waitsForCollision,
        nextFireAt: behaviour.intervalMs !== undefined ? Date.now() + behaviour.intervalMs : 0,
    });

    // A petal that parks for a collision runs nothing at spawn.
    if (!behaviour.waitsForCollision) behaviour.onSpawn?.(context);
}

/** A parked instance hit something. Replaces `handlePetalCollision`. */
export function petalBehaviourCollision(petalId: string, context: ActionContext): void {
    const state = petalBehaviourStates.get(petalId);
    if (state === undefined || !state.waitingForCollision) return;
    state.waitingForCollision = false;
    state.context = context;
    PETAL_BEHAVIOURS[state.petalType]?.onCollision?.(context);
}

/** The break effect — unconditional, see "immediate mode" in the header. */
export function runPetalBreakBehaviour(petalType: string | undefined, context: ActionContext): void {
    if (petalType === undefined) return;
    PETAL_BEHAVIOURS[petalType]?.onBreak?.(context);
}

/** Step the repeating effects. Replaces `updatePetalActions`. */
export function updatePetalBehaviours(): void {
    if (petalBehaviourStates.size === 0) return;
    const now = Date.now();
    for (const state of petalBehaviourStates.values()) {
        if (state.waitingForCollision) continue;
        const behaviour = PETAL_BEHAVIOURS[state.petalType];
        if (behaviour?.onInterval === undefined || behaviour.intervalMs === undefined) continue;
        if (now < state.nextFireAt) continue;
        state.nextFireAt = now + behaviour.intervalMs;
        behaviour.onInterval(state.context);
    }
}

/** Drop an instance's state, re-arming it. Replaces `cleanupPetalActions`. */
export function cleanupPetalBehaviour(petalId: string): void {
    petalBehaviourStates.delete(petalId);
}

/** Drop every instance belonging to a player, on disconnect / bot removal. */
export function cleanupPlayerPetalBehaviours(playerId: string): void {
    const prefix = `${playerId}_`;
    for (const petalId of petalBehaviourStates.keys()) {
        if (petalId.startsWith(prefix)) petalBehaviourStates.delete(petalId);
    }
}

// Update player effects (call this in the game loop)
export function updatePlayerEffects(player: ServerPlayer, deltaTime: number): void {
    if (!player.effects) return;

    const currentTime = Date.now();
    const expiredEffects: number[] = [];

    // Check for expired effects
    for (let i = 0; i < player.effects.length; i++) {
        const effect = player.effects[i];
        if (currentTime - effect.startTime >= effect.duration) {
            expiredEffects.push(i);
        }
    }

    // Remove expired effects
    for (let i = expiredEffects.length - 1; i >= 0; i--) {
        const effectIndex = expiredEffects[i];
        const effect = player.effects[effectIndex];
        console.log(`Player ${player.id} effect expired: ${effect.type}`);
        player.effects.splice(effectIndex, 1);
    }
}

// Get current damage multiplier from effects and skills
export function getDamageMultiplier(player: ServerPlayer): number {
    let multiplier = 1.0;
    
    // Apply skill multiplier first
    const skillMultiplier = getSkillMultiplier(player.skills?.damage);
    multiplier *= skillMultiplier;
    
    // Then apply petal effect multipliers
    if (player.effects) {
        for (const effect of player.effects) {
            if (effect.type === 'damage_boost') {
                multiplier *= effect.value;
            }
        }
    }
    
    return multiplier;
}

// Get current speed multiplier from effects and petal modifiers
export function getSpeedMultiplier(player: ServerPlayer): number {
    let multiplier = 1.0;
    
    // Apply petal modifiers first
    const { calculatePlayerModifiers } = require('./server/playerManager');
    const petalModifiers = calculatePlayerModifiers(player);
    if (petalModifiers.speed !== undefined) {
        multiplier *= petalModifiers.speed;
    }
    
    // Then apply temporary effect multipliers
    if (player.effects) {
        for (const effect of player.effects) {
            if (effect.type === 'speed_boost') {
                multiplier *= effect.value;
            }
        }
    }
    
    return multiplier;
}

// Get current shield amount from effects
export function getShieldAmount(player: ServerPlayer): number {
    if (!player.effects) return 0;

    let shield = 0;
    for (const effect of player.effects) {
        if (effect.type === 'shield') {
            shield += effect.value;
        }
    }
    return shield;
}









// Drop per-player entries from the module-level petal-action tracking maps so
// they don't accumulate for the whole server lifetime. lightningCutterStrikeTimes
// is keyed by playerId (a fresh socket id every reconnect) and splitExecutedPetalIds
// by `${playerId}_<i>_<j>` petal ids — neither was ever pruned, so both grew with
// every player/bot churn over a long session. Called on disconnect and bot removal.
export function cleanupPlayerPetalActionState(playerId: string): void {
    lightningCutterStrikeTimes.delete(playerId);
    cleanupPlayerPetalBehaviours(playerId);
    const prefix = `${playerId}_`;
    for (const petalId of splitExecutedPetalIds) {
        if (petalId.startsWith(prefix)) splitExecutedPetalIds.delete(petalId);
    }
}

// Split player into 2 players
export function splitPlayer(player: ServerPlayer, io: any): void {
    // Check if player is already split (check original ID and split IDs)
    const originalId = player.id.replace('_split2', '').replace('_split1', '');
    
    // If player is already split, don't split again
    if (splitPlayers.has(originalId)) {
        console.log(`[PetalActions] Player ${player.name} (${player.id}) is already split, skipping`);
        return;
    }
    
    // Also check if this is already a split player
    if (player.id.includes('_split')) {
        console.log(`[PetalActions] Player ${player.id} is already a split player, skipping`);
        return;
    }
    
    // Check if split player already exists in players map
    const splitPlayer2Id = `${originalId}_split2`;
    if (players[splitPlayer2Id]) {
        console.log(`[PetalActions] Split player ${splitPlayer2Id} already exists, skipping`);
        return;
    }

    // Share inventory (both players reference the same inventory object)
    // This allows items picked up by one player to be available to both
    
    // Deep clone loadout (including petal health, cooldowns, etc.)
    // Each player has their own loadout so they can equip different items
    const clonedLoadout: (Item | null)[] = player.loadout.map(item => {
        if (!item) return null;
        if (item.type === 'petal') {
            return {
                ...item,
                health: item.health,
                maxHealth: item.maxHealth,
                onCooldown: item.onCooldown
            };
        }
        return { ...item };
    });
    
    // Deep clone mobKills (separate kill tracking per player)
    const clonedMobKills: { [mobType: string]: { [rarity: string]: number } } = {};
    if (player.mobKills) {
        for (const mobType in player.mobKills) {
            clonedMobKills[mobType] = { ...player.mobKills[mobType] };
        }
    }
    
    // Deep clone skills (separate skill trees per player)
    const clonedSkills = player.skills ? { ...player.skills } : undefined;
    
    // Deep clone effects (separate active effects per player)
    const clonedEffects = player.effects ? player.effects.map(effect => ({ ...effect })) : undefined;
    
    // Create a duplicate player with separate state but shared inventory
    const splitPlayer2: ServerPlayer = {
        ...player,
        id: `${player.id}_split2`,
        x: player.x + 50, // Offset slightly to the right
        y: player.y,
        velocityX: 0, // Reset velocity
        velocityY: 0, // Reset velocity
        knockbackX: 0, // Reset knockback
        knockbackY: 0, // Reset knockback
        angle: player.angle, // Keep same angle
        inventory: player.inventory, // SHARED inventory (same reference)
        loadout: clonedLoadout, // Separate loadout
        mobKills: clonedMobKills, // Separate mob kills
        skills: clonedSkills, // Separate skills
        effects: clonedEffects, // Separate effects
        inputs: { keys: [] } // Separate input state
    };

    // Store split state using original ID
    splitPlayers.set(originalId, {
        player1: player,
        player2: splitPlayer2,
        activeIndex: 0,
        originalId: originalId
    });

    // Add the split player to the players map
    players[splitPlayer2.id] = splitPlayer2;
    
    // Recalculate stats for the split player (to apply petal modifiers from cloned loadout)
    const { recalculatePlayerStats } = require('./server/playerManager');
    recalculatePlayerStats(splitPlayer2, io);

    // Notify clients about the split
    io.emit('playerSplit', {
        originalId: originalId,
        player1Id: player.id,
        player2Id: splitPlayer2.id
    });
    
    // Send full player data including loadout to clients so they can render the split player's petals
    io.emit('playerUpdated', sanitizePlayerForClient(splitPlayer2));

    console.log(`[PetalActions] Player ${player.name} (${player.id}) split into 2 players with separate inventories and states`);
}

// Switch between split players
export function switchPlayer(player: ServerPlayer, io: any, socketId?: string): void {
    // Find the split state by checking if player is one of the split players
    let splitState: SplitPlayerState | undefined = undefined;
    let originalId: string = '';
    
    // First try to get by player.id (in case it's the original ID)
    splitState = splitPlayers.get(player.id);
    if (splitState) {
        originalId = player.id;
    } else {
        // Search through all split states to find which one contains this player
        for (const [origId, state] of splitPlayers.entries()) {
            if (state.player1.id === player.id || state.player2.id === player.id) {
                splitState = state;
                originalId = origId;
                break;
            }
        }
    }
    
    if (!splitState) {
        console.log(`[PetalActions] Player ${player.id} is not split, cannot switch`);
        return;
    }

    // Switch active player
    splitState.activeIndex = splitState.activeIndex === 0 ? 1 : 0;
    const activePlayerId = splitState.activeIndex === 0 ? splitState.player1.id : splitState.player2.id;
    // Get the actual player object from the players map to ensure we have the latest state
    const activePlayer = players[activePlayerId];
    
    if (!activePlayer) {
        console.warn(`[PetalActions] Active player ${activePlayerId} not found in players map`);
        return;
    }

    // Park the half we just left. Only the ACTIVE half receives inputs, so the
    // other one keeps replaying whichever mouse direction / held keys were last
    // written to it and walks off on its own forever — straight through mobs,
    // teleporters and walls. Keep an inputs OBJECT (updatePlayerState bails on a
    // missing one, which would freeze its petals and passive heal) but empty it,
    // and drop the velocity so it stops where it stands instead of coasting.
    const parkedPlayer = players[splitState.activeIndex === 0 ? splitState.player2.id : splitState.player1.id];
    if (parkedPlayer) {
        parkedPlayer.inputs = { keys: [], petalExtension: 1.0 };
        parkedPlayer.velocityX = 0;
        parkedPlayer.velocityY = 0;
    }

    // Notify the specific client (or all clients if socketId not provided)
    if (socketId) {
        io.to(socketId).emit('playerSwitched', {
            originalId: originalId,
            activePlayerId: activePlayerId
        });
        // Send full player data including loadout to the client so they can display the correct loadout
        io.to(socketId).emit('playerUpdated', sanitizePlayerForClient(activePlayer));
    } else {
        io.emit('playerSwitched', {
            originalId: originalId,
            activePlayerId: activePlayerId
        });
        // Send full player data including loadout to all clients
        io.emit('playerUpdated', sanitizePlayerForClient(activePlayer));
    }

    console.log(`[PetalActions] Switched to player ${splitState.activeIndex === 0 ? '1' : '2'} (activePlayerId=${activePlayerId})`);
}

// Stars are one wallet per client, but each split half carries its own numeric
// copy while the shop/redeem handlers always mutate players[socket.id] (half 1)
// and saves persist whichever half a given path grabs. Every live stars
// mutation must call this so both halves agree — an unsynced sibling turns
// spent stars back into saved stars (or drops earned ones) on the next save.
export function syncSplitStars(player: ServerPlayer): void {
    const originalId = player.id.replace('_split2', '').replace('_split1', '');
    const state = splitPlayers.get(originalId);
    if (!state) return;
    for (const id of [state.player1.id, state.player2.id]) {
        const half = players[id];
        if (half && half !== player) half.stars = player.stars;
    }
}

// Keep a live instance's behaviour context on the petal's real position, so an
// interval effect (shield, the test heal/explode petals) fires from where the
// petal actually is rather than from wherever it was built.
export function updatePetalPosition(petalId: string, x: number, y: number): void {
    const state = petalBehaviourStates.get(petalId);
    if (state) {
        state.context.petalX = x;
        state.context.petalY = y;
    }
}
