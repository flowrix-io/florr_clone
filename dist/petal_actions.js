"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PETAL_BEHAVIOURS = exports.splitPlayers = void 0;
exports.grantShield = grantShield;
exports.despawnPet = despawnPet;
exports.countPlayerPetsByMobType = countPlayerPetsByMobType;
exports.despawnPetAndReloadEgg = despawnPetAndReloadEgg;
exports.despawnAllPlayerPets = despawnAllPlayerPets;
exports.spawnPet = spawnPet;
exports.hasPetalBehaviour = hasPetalBehaviour;
exports.armPetalBehaviour = armPetalBehaviour;
exports.petalBehaviourCollision = petalBehaviourCollision;
exports.runPetalBreakBehaviour = runPetalBreakBehaviour;
exports.updatePetalBehaviours = updatePetalBehaviours;
exports.cleanupPetalBehaviour = cleanupPetalBehaviour;
exports.cleanupPlayerPetalBehaviours = cleanupPlayerPetalBehaviours;
exports.updatePlayerEffects = updatePlayerEffects;
exports.getDamageMultiplier = getDamageMultiplier;
exports.getSpeedMultiplier = getSpeedMultiplier;
exports.getShieldAmount = getShieldAmount;
exports.cleanupPlayerPetalActionState = cleanupPlayerPetalActionState;
exports.splitPlayer = splitPlayer;
exports.switchPlayer = switchPlayer;
exports.syncSplitStars = syncSplitStars;
exports.updatePetalPosition = updatePetalPosition;
const petals_1 = require("./petals");
const skill_multipliers_1 = require("./skill_multipliers");
const mobFields_1 = require("./server/mobFields");
const scopedEmit_1 = require("./server/scopedEmit");
const enemyWire_1 = require("./server/enemyWire");
const playerWire_1 = require("./server/playerWire");
const server_utils_1 = require("./server_utils");
const server_1 = require("./server");
const enemyRegistry_1 = require("./server/enemyRegistry");
const killHandler_1 = require("./server/shared/killHandler");
const constants_1 = require("./constants");
const enemyGrid_1 = require("./server/enemyGrid");
const utils_1 = require("./server/utils");
const database_1 = require("./database");
const gameState_1 = require("./server/gameState");
const mobs_1 = require("./mobs");
const enemySpawner_1 = require("./server/enemySpawner");
const petalEvents_1 = require("./server/petalEvents");
const wireOutbox_1 = require("./server/wireOutbox");
/** Snapshot buffer for pet loops that despawn while iterating. */
const petScratch = [];
/**
 * Build a kill context for the partial death handlers in explodePetal /
 * strikeLightning. Those paths never call trackMobKill or cleanupEnemy
 * (trackMobKillTiming: 'none', skipCleanup: true), so those two ctx fields
 * are stubbed. `database` and `playerUserIds` are NOT stubbable, though:
 * killEnemy's credited-player branch reads them (via
 * getLeaderboardRewardMultipliers) to grant the leaderboard reward tiers, so
 * they must be the real live references.
 */
function makePetalKillCtx(io) {
    return {
        io,
        players: constants_1.players,
        playerUserIds: gameState_1.playerUserIds,
        database: database_1.database,
        removeEnemy: enemyRegistry_1.removeEnemy,
        // Stubs — only reachable when trackMobKillTiming !== 'none', which
        // explodePetal/strikeLightning never pass.
        savePlayerProgress: undefined,
        trackMobKill: undefined,
        cleanupEnemy: undefined,
        // Real deps:
        addXPToPlayer: server_1.addXPToPlayer,
        handleMobDrops: server_1.handleMobDrops,
        sendBossMobDefeatedMessage: server_1.sendBossMobDefeatedMessage,
        updateSpecialMobCounts: server_1.updateSpecialMobCounts,
    };
}
exports.splitPlayers = new Map();
// Track which petals have already executed split_player to prevent re-execution
const splitExecutedPetalIds = new Set();
// Explosion throttle state
let lastExplosionTime = 0;
const EXPLOSION_THROTTLE_MS = 20;
// Lightning rate limiter for lightning_cutter (2 per second = 500ms minimum between strikes)
const lightningCutterStrikeTimes = new Map(); // playerId -> array of strike times
const LIGHTNING_CUTTER_RATE_LIMIT_MS = 500; // Minimum 500ms between strikes (2 per second)
const LIGHTNING_CUTTER_MAX_STRIKES = 2; // Maximum 2 strikes per second
// Skill multipliers based on rarity tier
// Heal the player
function healPlayer(player, healAmount, io, context) {
    const oldHealth = player.health;
    // Apply rarity scaling (sqrt(3) per rarity level)
    let rarityMultiplier = 1.0;
    if (context && context.loadoutIndex !== undefined) {
        const petal = player.loadout[context.loadoutIndex];
        if (petal && petal.type === 'petal' && petal.rarity) {
            const rarityIndex = (0, petals_1.getRarityIndex)(petal.rarity);
            if (rarityIndex >= 0) {
                rarityMultiplier = Math.pow(Math.sqrt(3), rarityIndex);
            }
        }
    }
    // Apply healing multiplier skill bonus
    const healingMultiplier = (0, skill_multipliers_1.getEffectSkillMultiplier)(player.skills?.healingMultiplier);
    const modifiedHealAmount = healAmount * rarityMultiplier * healingMultiplier * 3;
    player.health = Math.min(player.maxHealth, player.health + modifiedHealAmount);
    if (player.health !== oldHealth) {
        (0, wireOutbox_1.getWireOutbox)().all('playerHealed', {
            playerId: player.id,
            health: player.health,
            healAmount: player.health - oldHealth
        });
    }
}
function applyPlayerEffect(player, type, value, duration) {
    if (!player.effects)
        player.effects = [];
    player.effects = player.effects.filter(e => e.type !== type);
    player.effects.push({ type, value, duration, startTime: Date.now() });
}
/**
 * Grant (or refresh) a temporary shield on a flower. Shell's burst shield uses
 * this; effects of a given type don't stack (applyPlayerEffect replaces), which
 * matches gardn where a fresh shell overwrites rather than adds.
 */
function grantShield(player, amount, durationMs) {
    applyPlayerEffect(player, 'shield', amount, durationMs);
}
/**
 * Cap on how many struck mobs ride the lightningStrike VFX payload. Prod
 * measured this event at 1.0 KB average / 302 KB/s, and a strike into a dense
 * mob pile made `targets` as long as the pile.
 */
const LIGHTNING_VFX_MAX_TARGETS = 24;
/**
 * Trim the VFX target list to the cap, NEAREST FIRST.
 *
 * It must not be a plain `slice`. queryEnemiesNear walks its cell range as
 * `for cy { for cx { ... } }`, so the result is ordered by increasing y — and
 * the strike loop consumes it in reverse. Taking the first N off that array
 * therefore selected the N mobs furthest down the screen, and every bolt in a
 * dense pile fanned downward and never up.
 *
 * Distance from the strike origin has no directional bias: the chosen set is a
 * disc around the origin, which is also what the effect should look like.
 */
function pickVfxTargets(targets, originX, originY) {
    if (targets.length <= LIGHTNING_VFX_MAX_TARGETS)
        return targets;
    // Copy before sorting: `targets` order is not otherwise meaningful, but the
    // caller still owns it.
    return targets
        .slice()
        .sort((a, b) => {
        const adx = a.x - originX, ady = a.y - originY;
        const bdx = b.x - originX, bdy = b.y - originY;
        return (adx * adx + ady * ady) - (bdx * bdx + bdy * bdy);
    })
        .slice(0, LIGHTNING_VFX_MAX_TARGETS);
}
/** Reused across explosions so the grid query allocates nothing per call. */
const _explodeScratch = [];
/** Same, for lightning strikes. */
const _lightningScratch = [];
// Explode petal and deal area damage
function explodePetal(x, y, petalSize, damage, enemies, io, player) {
    // Throttle explosions to 1 per 20ms
    const currentTime = Date.now();
    if (currentTime - lastExplosionTime < EXPLOSION_THROTTLE_MS) {
        return;
    }
    lastExplosionTime = currentTime;
    const explosionRadius = petalSize * 40 * 3; // Convert petal size to pixels and make explosion 3x larger
    // Grid query, not a scan of every mob in the world. An explosion only ever
    // reaches explosionRadius, but this used to walk all ~1600 enemies and take
    // a Math.sqrt for each — per explosion, and explosions come in bursts. That
    // full sweep (plus a per-hit `require`, plus a per-hit broadcast) is what
    // made a single petal detonation stall the tick.
    const hits = (0, enemyGrid_1.queryEnemiesNear)(x, y, explosionRadius, _explodeScratch);
    const radiusSq = explosionRadius * explosionRadius;
    // Reverse order: killEnemy splices `enemies`, and indices are resolved
    // against that array below.
    for (let qi = hits.length - 1; qi >= 0; qi--) {
        const enemy = hits[qi];
        // Skip all pets (pets should not be damaged by any player's explosions)
        if (enemy.ownerId) {
            continue;
        }
        // The grid returns a cell-aligned superset, so the exact radius test
        // still has to run — squared, to keep the sqrt out of the hot path.
        const ddx = (0, mobFields_1.mobX)(enemy.entity) - x;
        const ddy = (0, mobFields_1.mobY)(enemy.entity) - y;
        if (ddx * ddx + ddy * ddy <= radiusSq) {
            const distance = Math.sqrt(ddx * ddx + ddy * ddy);
            // Track damage if player is provided
            if (player) {
                (0, server_1.trackDamage)(enemy, player.id, damage);
            }
            (0, mobFields_1.damageMob)(enemy.entity, damage);
            // Apply knockback
            const knockbackForce = 20;
            const dx = (0, mobFields_1.mobX)(enemy.entity) - x;
            const dy = (0, mobFields_1.mobY)(enemy.entity) - y;
            const normalizedDx = dx / (distance || 1);
            const normalizedDy = dy / (distance || 1);
            (0, mobFields_1.setMobKnockback)(enemy.entity, normalizedDx * knockbackForce, normalizedDy * knockbackForce);
            (0, utils_1.markEnemyDamaged)(enemy);
            // Check if enemy dies
            if ((0, mobFields_1.mobHealth)(enemy.entity) <= 0) {
                // Earlier kills in this same explosion may already have taken
                // it: the grid result is a snapshot, the world is not.
                if (!(0, enemyRegistry_1.isEnemyLive)(enemy))
                    continue;
                // Explode/lightning never ran cleanupEnemy or trackMobKill
                // historically (skipCleanup + timing 'none' preserve that).
                (0, killHandler_1.killEnemy)(enemy, makePetalKillCtx(io), {
                    killerPlayerId: player?.id,
                    skipCleanup: true,
                    trackMobKillTiming: 'none',
                });
            }
        }
    }
    // Emit explosion effect to clients
    (0, wireOutbox_1.getWireOutbox)().all('petalExplosion', {
        x: x,
        y: y,
        radius: explosionRadius,
        damage: damage
    });
}
// Check if lightning strike is allowed for lightning_cutter (rate limit: 2 per second)
function canStrikeLightning(player, context) {
    if (!player)
        return true; // Allow if no player (shouldn't happen but be safe)
    // Check if this is from a lightning_cutter petal
    let isLightningCutter = false;
    if (context && context.loadoutIndex !== undefined) {
        const petal = player.loadout[context.loadoutIndex];
        if (petal && petal.type === 'petal' && petal.petalType === 'lightning_cutter') {
            isLightningCutter = true;
        }
    }
    // Only apply rate limit to lightning_cutter
    if (!isLightningCutter)
        return true;
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
function strikeLightning(x, y, radius, enemies, io, player, petalDamage, context) {
    // Check rate limit for lightning_cutter
    if (!canStrikeLightning(player, context)) {
        return; // Rate limit exceeded, skip this lightning strike
    }
    const targets = [];
    // Grid query rather than a sweep of every mob in the world — same reason as
    // explodePetal above, and lightning fires on an interval.
    const struck = (0, enemyGrid_1.queryEnemiesNear)(x, y, radius, _lightningScratch);
    const radiusSq = radius * radius;
    // Reverse: killEnemy splices `enemies`, and the index is resolved below.
    for (let qi = struck.length - 1; qi >= 0; qi--) {
        const enemy = struck[qi];
        // Skip all pets (pets should not be damaged by any player's lightning)
        if (enemy.ownerId) {
            continue;
        }
        // The grid returns a cell-aligned superset; exact test, squared.
        const ldx = (0, mobFields_1.mobX)(enemy.entity) - x;
        const ldy = (0, mobFields_1.mobY)(enemy.entity) - y;
        if (ldx * ldx + ldy * ldy <= radiusSq) {
            targets.push({
                x: (0, mobFields_1.mobX)(enemy.entity),
                y: (0, mobFields_1.mobY)(enemy.entity),
                enemyId: enemy.id
            });
            // Deal damage to the enemy - use petal damage for rarity scaling
            const damage = petalDamage || 25; // Use petal damage if available, fallback to 25
            // Track damage if player is provided
            if (player) {
                (0, server_1.trackDamage)(enemy, player.id, damage);
            }
            (0, mobFields_1.damageMob)(enemy.entity, damage);
            (0, utils_1.markEnemyDamaged)(enemy);
            // Check if enemy dies
            if ((0, mobFields_1.mobHealth)(enemy.entity) <= 0) {
                // See the matching note in explodePetal.
                if (!(0, enemyRegistry_1.isEnemyLive)(enemy))
                    continue;
                (0, killHandler_1.killEnemy)(enemy, makePetalKillCtx(io), {
                    killerPlayerId: player?.id,
                    skipCleanup: true,
                    trackMobKillTiming: 'none',
                });
            }
        }
    }
    // Emit lightning effect to clients
    // VFX: only clients who can see the strike. This was a full fan-out
    // carrying every struck mob — prod measured 1.0 KB average at 297 msg/s
    // (302 KB/s), and a lightning petal fired into an admin-spawned mob pile
    // makes `targets` as long as the pile.
    (0, scopedEmit_1.emitToViewers)(x, y, 'lightningStrike', {
        x: x,
        y: y,
        // VFX only — damage above already applied to every struck mob. Past a
        // couple of dozen the bolts overlap into a solid blob, so sending more
        // buys nothing visible and costs payload plus client draw work.
        targets: pickVfxTargets(targets, x, y),
        damage: petalDamage || 25
    }, player?.id);
}
// Helper function to find a player's pet by mob type
function findPlayerPetByMobType(ownerId, mobType) {
    return (0, enemyRegistry_1.liveEnemies)().find(enemy => enemy.ownerId === ownerId &&
        enemy.type === mobType);
}
// Helper function to despawn a pet
function despawnPet(pet, io) {
    // For centipede pets, drop the whole chain — otherwise the first orphaned
    // body segment would auto-promote into a new free-roaming head.
    if ((0, server_utils_1.isCentipedeHeadType)(pet.type)) {
        for (const e of (0, enemyRegistry_1.collectEnemies)(petScratch)) {
            if (e.id === pet.id || ((0, server_utils_1.isCentipedeBodyType)(e.type) && e.headId === pet.id)) {
                (0, enemyRegistry_1.removeEnemy)(e);
                (0, wireOutbox_1.getWireOutbox)().all('enemyDestroyed', e.id);
            }
        }
        return;
    }
    if ((0, enemyRegistry_1.removeEnemy)(pet)) {
        (0, wireOutbox_1.getWireOutbox)().all('enemyDestroyed', pet.id);
        // console.log(`Despawned pet ${pet.tier} ${pet.type} for player ${pet.ownerId}`);
    }
}
/** How many pet entities of this mob type a player currently owns (centipede
 *  body segments excluded, so a live centipede pet counts once). */
function countPlayerPetsByMobType(ownerId, mobType) {
    let count = 0;
    for (const enemy of (0, enemyRegistry_1.liveEnemies)()) {
        if (enemy.ownerId === ownerId && enemy.type === mobType)
            count++;
    }
    return count;
}
/**
 * A passive or sandstorm pet drifted off its owner's screen: despawn it and
 * put the egg petal that hatched it on reload. No restore timer is scheduled
 * here — the tick-loop cooldown backstop in playerState restores the petal
 * when the stamped deadline passes, and that restore re-hatches the pet.
 */
function despawnPetAndReloadEgg(pet, io) {
    const ownerId = pet.ownerId;
    despawnPet(pet, io);
    if (!ownerId)
        return;
    const player = constants_1.players[ownerId];
    if (!player || !player.loadout)
        return;
    for (let i = 0; i < player.loadout.length; i++) {
        const petal = player.loadout[i];
        if (!petal || petal.type !== 'petal' || petal.onCooldown || !petal.petalType || !petal.rarity)
            continue;
        const stats = (0, petals_1.getPetalStats)(petal.petalType, petal.rarity);
        if (stats?.petMobType !== pet.type)
            continue;
        petal.onCooldown = true;
        // The absolute deadline is the ONLY restore trigger for this break, so
        // it must be stamped — see the backstop note in updatePlayerState.
        petal.cooldownEndTime = Date.now() + (0, petals_1.getEffectivePetalCooldown)(petal.petalType, petal.rarity, stats);
        (0, petalEvents_1.emitPetalBroken)(player.id, {
            playerId: player.id,
            slotIndex: i,
            petalType: petal.petalType,
            rarity: petal.rarity,
        }, player.x, player.y);
        break;
    }
}
// Despawn all pets owned by a player
function despawnAllPlayerPets(playerId, io) {
    for (const pet of (0, enemyRegistry_1.collectEnemies)(petScratch)) {
        if (pet.ownerId === playerId) {
            (0, wireOutbox_1.getWireOutbox)().all('enemyDestroyed', pet.id);
            (0, enemyRegistry_1.removeEnemy)(pet);
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
const PET_STAT_MULTIPLIERS = {
    digger: { health: 0.5, damage: 0.5 },
};
// Spawn a pet mob that belongs to a player
function spawnPet(mobType, rarity, x, y, ownerId, io, skipDuplicateCheck = false, count = 1) {
    // Petals that summon a squad (stick -> two sandstorms). The duplicate check
    // runs once for the whole squad, otherwise each summon would despawn the
    // previous one and only the last would survive.
    if (count > 1) {
        if (!skipDuplicateCheck) {
            for (const existing of (0, enemyRegistry_1.collectEnemies)(petScratch)) {
                if (existing.ownerId === ownerId && existing.type === mobType) {
                    despawnPet(existing, io);
                }
            }
        }
        for (let i = 0; i < count; i++) {
            spawnPet(mobType, rarity, x, y, ownerId, io, true, 1);
        }
        return;
    }
    // Validate mob type
    const allMobTypes = (0, mobs_1.getAllMobTypes)();
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
        for (const existing of (0, enemyRegistry_1.collectEnemies)(petScratch)) {
            if (existing.ownerId === ownerId && existing.type === mobType) {
                despawnPet(existing, io);
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
    for (const e of (0, enemyRegistry_1.liveEnemies)()) {
        if (e.ownerId === ownerId)
            ownedEntities++;
    }
    if (ownedEntities >= MAX_PET_ENTITIES_PER_PLAYER) {
        console.log(`[PET] Player ${ownerId} is at the pet entity cap (${MAX_PET_ENTITIES_PER_PLAYER}); not spawning ${mobType}`);
        return;
    }
    const tier = rarity.toLowerCase();
    const mobStats = (0, mobs_1.getMobStats)(mobType, tier);
    if (!mobStats) {
        console.log(`No stats found for pet ${mobType} with rarity ${tier}`);
        return;
    }
    // Calculate range bonus: +200 per rarity level
    const rarityIndex = (0, petals_1.getRarityIndex)(rarity.toLowerCase());
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
    // Create the pet enemy (ECS entity + liveEnemies()[] admission, atomically)
    // aiType is NOT overridden: the pet keeps its config ai_type, and the pet
    // AI loop maps it (hostile/neutral attack for the owner, passive stays
    // passive, sandstorm drifts). Pets can't target or contact-damage players
    // regardless — the pet AI never scans players and the player-contact grid
    // excludes pets.
    const pet = (0, enemyRegistry_1.spawnEnemy)(mobType, tier, x, y, {
        range: petRange,
        ownerId, // Set the owner
        petImage: mobStats.petImage, // Use pet image if available
        maxHealth: statMods ? mobStats.health * statMods.health : undefined,
        damage: statMods ? mobStats.damage * statMods.damage : undefined,
    }); // mobStats validated above
    // Notify all clients
    (0, enemyWire_1.emitEnemySpawned)(pet);
    // Centipede pets need their trailing body chain too, with ownerId propagated
    // to each segment so they follow the owner alongside the head.
    if ((0, server_utils_1.isCentipedeHeadType)(mobType)) {
        for (const segment of (0, enemySpawner_1.spawnCentipedeBodySegments)(pet)) {
            (0, enemyWire_1.emitEnemySpawned)(segment);
        }
    }
    // console.log(`Spawned pet ${tier} ${mobType} for player ${ownerId} at (${Math.round(x)}, ${Math.round(y)})`);
}
// Mark petal for breaking
function markPetalForBreak(petalId, context) {
    const { player, loadoutIndex } = context;
    if (loadoutIndex !== undefined && player.loadout[loadoutIndex]) {
        const petal = player.loadout[loadoutIndex];
        if (!petal)
            return;
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
        (0, petalEvents_1.emitPetalBroken)(player.id, {
            playerId: player.id,
            loadoutIndex: loadoutIndex,
            petalType: petal.petalType
        }, player.x, player.y);
        // Get cooldown time from petal stats
        const cooldownTime = (0, petals_1.getEffectivePetalCooldown)(petal.petalType, petal.rarity);
        // Deadline for the tick-loop restore backstop in playerState — a break
        // with no stamp gets restored on the next tick instead of reloading.
        petal.cooldownEndTime = Date.now() + cooldownTime;
        // Schedule petal restoration.
        // Snapshot identity so a stale timer doesn't clobber a swapped slot.
        const snapshotPetalType = originalPetal.petalType;
        const snapshotRarity = originalPetal.rarity;
        setTimeout(() => {
            const current = player.loadout[loadoutIndex];
            if (!current || !current.onCooldown)
                return;
            if (current.type !== 'petal' ||
                current.petalType !== snapshotPetalType ||
                current.rarity !== snapshotRarity)
                return;
            // Restore petal after cooldown
            player.loadout[loadoutIndex] = {
                ...originalPetal,
                health: originalPetal.maxHealth,
                onCooldown: false
            };
            // Emit restoration event
            (0, petalEvents_1.emitPetalRestored)(player.id, {
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
/** `if memory:player:extended == 1` — petals held out rather than orbiting. */
function petalsExtended(player) {
    return (player.inputs?.petalExtension || 1.0) > 1.0;
}
const strike1000 = (c) => strikeLightning(c.petalX, c.petalY, 1000, c.enemies, c.io, c.player, c.petalDamage, c);
const explode = (damage) => (c) => explodePetal(c.petalX, c.petalY, c.petalSize, damage, c.enemies, c.io, c.player);
const heal = (amount) => (c) => healPlayer(c.player, amount, c.io, c);
const breakSelf = (c) => {
    if (c.petalId)
        markPetalForBreak(c.petalId, c);
};
/**
 * Petal type -> behaviour. The scripts each entry replaces are quoted so the
 * two can be diffed by eye; the `actions` field they came from is gone.
 */
exports.PETAL_BEHAVIOURS = {
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
            if (!petalsExtended(c.player))
                return;
            explode(100)(c);
            heal(-1)(c);
        },
        onBreak: (c) => { explode(100)(c); heal(-1)(c); },
    },
    // `if memory:player:health < 75; heal 25; endif;`
    starfish: {
        onSpawn: (c) => { if (c.player.health < 75)
            heal(25)(c); },
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
function hasPetalBehaviour(petalType) {
    return petalType !== undefined
        && Object.prototype.hasOwnProperty.call(exports.PETAL_BEHAVIOURS, petalType);
}
const petalBehaviourStates = new Map();
/**
 * Arm (or refresh) an instance's behaviour. Called every tick while the petal
 * exists, exactly as `executePetalActionsOnSpawn` was.
 *
 * The refresh matters: the context carries the petal's LIVE position, and the
 * interval effects below fire from wherever the petal currently is. First call
 * runs the spawn effect; later calls only update the context.
 */
function armPetalBehaviour(petalType, context) {
    if (petalType === undefined || !context.petalId)
        return;
    const behaviour = exports.PETAL_BEHAVIOURS[petalType];
    if (behaviour === undefined)
        return;
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
    if (!behaviour.waitsForCollision)
        behaviour.onSpawn?.(context);
}
/** A parked instance hit something. Replaces `handlePetalCollision`. */
function petalBehaviourCollision(petalId, context) {
    const state = petalBehaviourStates.get(petalId);
    if (state === undefined || !state.waitingForCollision)
        return;
    state.waitingForCollision = false;
    state.context = context;
    exports.PETAL_BEHAVIOURS[state.petalType]?.onCollision?.(context);
}
/** The break effect — unconditional, see "immediate mode" in the header. */
function runPetalBreakBehaviour(petalType, context) {
    if (petalType === undefined)
        return;
    exports.PETAL_BEHAVIOURS[petalType]?.onBreak?.(context);
}
/** Step the repeating effects. Replaces `updatePetalActions`. */
function updatePetalBehaviours() {
    if (petalBehaviourStates.size === 0)
        return;
    const now = Date.now();
    for (const state of petalBehaviourStates.values()) {
        if (state.waitingForCollision)
            continue;
        const behaviour = exports.PETAL_BEHAVIOURS[state.petalType];
        if (behaviour?.onInterval === undefined || behaviour.intervalMs === undefined)
            continue;
        if (now < state.nextFireAt)
            continue;
        state.nextFireAt = now + behaviour.intervalMs;
        behaviour.onInterval(state.context);
    }
}
/** Drop an instance's state, re-arming it. Replaces `cleanupPetalActions`. */
function cleanupPetalBehaviour(petalId) {
    petalBehaviourStates.delete(petalId);
}
/** Drop every instance belonging to a player, on disconnect / bot removal. */
function cleanupPlayerPetalBehaviours(playerId) {
    const prefix = `${playerId}_`;
    for (const petalId of petalBehaviourStates.keys()) {
        if (petalId.startsWith(prefix))
            petalBehaviourStates.delete(petalId);
    }
}
// Update player effects (call this in the game loop)
function updatePlayerEffects(player, deltaTime) {
    if (!player.effects)
        return;
    const currentTime = Date.now();
    const expiredEffects = [];
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
function getDamageMultiplier(player) {
    let multiplier = 1.0;
    // Apply skill multiplier first
    const skillMultiplier = (0, skill_multipliers_1.getEffectSkillMultiplier)(player.skills?.damage);
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
function getSpeedMultiplier(player) {
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
function getShieldAmount(player) {
    if (!player.effects)
        return 0;
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
function cleanupPlayerPetalActionState(playerId) {
    lightningCutterStrikeTimes.delete(playerId);
    cleanupPlayerPetalBehaviours(playerId);
    const prefix = `${playerId}_`;
    for (const petalId of splitExecutedPetalIds) {
        if (petalId.startsWith(prefix))
            splitExecutedPetalIds.delete(petalId);
    }
}
// Split player into 2 players
function splitPlayer(player, io) {
    // Check if player is already split (check original ID and split IDs)
    const originalId = player.id.replace('_split2', '').replace('_split1', '');
    // If player is already split, don't split again
    if (exports.splitPlayers.has(originalId)) {
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
    if (constants_1.players[splitPlayer2Id]) {
        console.log(`[PetalActions] Split player ${splitPlayer2Id} already exists, skipping`);
        return;
    }
    // Share inventory (both players reference the same inventory object)
    // This allows items picked up by one player to be available to both
    // Deep clone loadout (including petal health, cooldowns, etc.)
    // Each player has their own loadout so they can equip different items
    const clonedLoadout = player.loadout.map(item => {
        if (!item)
            return null;
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
    const clonedMobKills = {};
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
    const splitPlayer2 = {
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
    exports.splitPlayers.set(originalId, {
        player1: player,
        player2: splitPlayer2,
        activeIndex: 0,
        originalId: originalId
    });
    // Add the split player to the players map
    constants_1.players[splitPlayer2.id] = splitPlayer2;
    // Recalculate stats for the split player (to apply petal modifiers from cloned loadout)
    const { recalculatePlayerStats } = require('./server/playerManager');
    recalculatePlayerStats(splitPlayer2, io);
    // Notify clients about the split
    (0, wireOutbox_1.getWireOutbox)().all('playerSplit', {
        originalId: originalId,
        player1Id: player.id,
        player2Id: splitPlayer2.id
    });
    // Send full player data including loadout to clients so they can render the split player's petals
    (0, wireOutbox_1.getWireOutbox)().all('playerUpdated', (0, playerWire_1.sanitizePlayerForClient)(splitPlayer2));
    console.log(`[PetalActions] Player ${player.name} (${player.id}) split into 2 players with separate inventories and states`);
}
// Switch between split players
function switchPlayer(player, io, socketId) {
    // Find the split state by checking if player is one of the split players
    let splitState = undefined;
    let originalId = '';
    // First try to get by player.id (in case it's the original ID)
    splitState = exports.splitPlayers.get(player.id);
    if (splitState) {
        originalId = player.id;
    }
    else {
        // Search through all split states to find which one contains this player
        for (const [origId, state] of exports.splitPlayers.entries()) {
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
    const activePlayer = constants_1.players[activePlayerId];
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
    const parkedPlayer = constants_1.players[splitState.activeIndex === 0 ? splitState.player2.id : splitState.player1.id];
    if (parkedPlayer) {
        parkedPlayer.inputs = { keys: [], petalExtension: 1.0 };
        parkedPlayer.velocityX = 0;
        parkedPlayer.velocityY = 0;
    }
    // Notify the specific client (or all clients if socketId not provided)
    if (socketId) {
        (0, wireOutbox_1.getWireOutbox)().toSocket(socketId, 'playerSwitched', {
            originalId: originalId,
            activePlayerId: activePlayerId
        });
        // Send full player data including loadout to the client so they can display the correct loadout
        (0, wireOutbox_1.getWireOutbox)().toSocket(socketId, 'playerUpdated', (0, playerWire_1.sanitizePlayerForClient)(activePlayer));
    }
    else {
        (0, wireOutbox_1.getWireOutbox)().all('playerSwitched', {
            originalId: originalId,
            activePlayerId: activePlayerId
        });
        // Send full player data including loadout to all clients
        (0, wireOutbox_1.getWireOutbox)().all('playerUpdated', (0, playerWire_1.sanitizePlayerForClient)(activePlayer));
    }
    console.log(`[PetalActions] Switched to player ${splitState.activeIndex === 0 ? '1' : '2'} (activePlayerId=${activePlayerId})`);
}
// Stars are one wallet per client, but each split half carries its own numeric
// copy while the shop/redeem handlers always mutate players[socket.id] (half 1)
// and saves persist whichever half a given path grabs. Every live stars
// mutation must call this so both halves agree — an unsynced sibling turns
// spent stars back into saved stars (or drops earned ones) on the next save.
function syncSplitStars(player) {
    const originalId = player.id.replace('_split2', '').replace('_split1', '');
    const state = exports.splitPlayers.get(originalId);
    if (!state)
        return;
    for (const id of [state.player1.id, state.player2.id]) {
        const half = constants_1.players[id];
        if (half && half !== player)
            half.stars = player.stars;
    }
}
// Keep a live instance's behaviour context on the petal's real position, so an
// interval effect (shield, the test heal/explode petals) fires from where the
// petal actually is rather than from wherever it was built.
function updatePetalPosition(petalId, x, y) {
    const state = petalBehaviourStates.get(petalId);
    if (state) {
        state.context.petalX = x;
        state.context.petalY = y;
    }
}
