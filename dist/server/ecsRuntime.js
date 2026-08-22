"use strict";
/**
 * ECS composition root for the server.
 *
 * This is the one place that knows both the ECS layer and the game's existing
 * modules, so everything above it stays decoupled: `src/ecs/**` never imports
 * constants.ts, petal_actions.ts or the map, which is what keeps the ECS
 * typecheckable and testable on its own in about a second.
 *
 * It is also where the injected dependencies get their REAL implementations —
 * most importantly `stepPlayerMovement`, which is passed through verbatim
 * rather than reimplemented so the server and the client's movement prediction
 * keep executing the same physics.
 *
 * Nothing calls this yet. It exists so the tick loop can be moved over one
 * system at a time with the wiring already in place and verified.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEcsRuntime = createEcsRuntime;
const constants_1 = require("../constants");
const map_data_1 = require("../map_data");
const lineOfSight_1 = require("./lineOfSight");
const physics_1 = require("./physics");
const petals_1 = require("../petals");
const mobs_1 = require("../mobs");
const ecs_1 = require("../ecs");
const C = __importStar(require("../ecs/components"));
const prefabs_1 = require("../ecs/prefabs");
const grid_1 = require("../ecs/spatial/grid");
const interning_1 = require("../ecs/interning");
const projectileFiring_1 = require("../ecs/systems/projectileFiring");
const projectileCollision_1 = require("../ecs/systems/projectileCollision");
const mobCollision_1 = require("../ecs/systems/mobCollision");
const afflictions_1 = require("../ecs/systems/afflictions");
const rarity_1 = require("./shared/rarity");
const playerModifiers_1 = require("./shared/playerModifiers");
const lifetime_1 = require("../ecs/systems/lifetime");
const centipede_1 = require("../ecs/systems/centipede");
const enemyAI_1 = require("../ecs/systems/enemyAI");
const lod_1 = require("../ecs/systems/lod");
const enemyPassive_1 = require("../ecs/systems/enemyPassive");
const movement_1 = require("../ecs/systems/movement");
const viewport_1 = require("../ecs/systems/viewport");
const playerMovement_1 = require("../ecs/systems/playerMovement");
const playerModifiers_2 = require("../ecs/systems/playerModifiers");
const groundEffects_1 = require("../ecs/systems/groundEffects");
const droppedItems_1 = require("../ecs/systems/droppedItems");
const spawning_1 = require("../ecs/systems/spawning");
function createEcsRuntime(options) {
    const { creditDamage, onEnemyDamaged, onEnemyKilled, isNearAnyPlayer } = options;
    const world = new ecs_1.World();
    const scheduler = new ecs_1.Scheduler(world);
    /**
     * Projectiles run on their OWN scheduler so they can be stepped with the
     * real elapsed time exactly once per simulation step, while the mob
     * scheduler above is replayed at a fixed step to catch up. See
     * EcsRuntime.tickProjectiles.
     */
    const projectileScheduler = new ecs_1.Scheduler(world);
    /**
     * Players run on their OWN scheduler so the caller can place them at the
     * point in the server tick the legacy movement occupied — before
     * `updatePlayerState`, and therefore before `moveEnemies` runs the mob
     * scheduler. See EcsRuntime.tickPlayers.
     */
    const playerScheduler = new ecs_1.Scheduler(world);
    /**
     * Inputs run on their OWN scheduler so the caller can place them where the
     * legacy `updateBotAI` call sat — before the whole simulation step, and
     * therefore before anything reads an input. See EcsRuntime.tickInput.
     */
    const inputScheduler = new ecs_1.Scheduler(world);
    /**
     * The post-movement player pipeline runs on its own scheduler so it can sit
     * after the movement window closes. See EcsRuntime.tickPlayerPipeline.
     */
    const pipelineScheduler = new ecs_1.Scheduler(world);
    /**
     * Ground effects run on their OWN scheduler, ticked right after the
     * projectile one, so they see the same freshly-rebuilt grid and their
     * damage rides the caller's post-projectile write-back. See
     * EcsRuntime.tickWorld.
     */
    const worldScheduler = new ecs_1.Scheduler(world);
    const grid = new grid_1.SpatialGrid();
    const gridResult = new grid_1.GridQueryResult(256);
    /**
     * The grid is fed by the same predicate the old rebuild used: wild, living
     * mobs only. Pets are excluded because callers of the broad phase expect not
     * to have to filter them, and the dead because they are pending reaping.
     */
    const gridSource = world.query([C.Position, C.Radius, C.IsEnemy], [C.IsDead, C.PetOwner]);
    // NO grid rebuild on the mob scheduler.
    //
    // There used to be one here, on the grounds that "bot targeting queries it".
    // Bot targeting reads the LEGACY enemy grid (see tickInput), and a sweep of
    // every `grid`/`gridResult` reference shows projectileCollision is the only
    // consumer this object has — on the PROJECTILE scheduler, which rebuilds the
    // grid itself in `tickProjectiles` immediately before ticking. So the
    // rebuild here was a full fat-insertion pass over every mob, every tick,
    // whose result was overwritten before anything read it.
    //
    // If a system on THIS scheduler ever needs the shared broad phase, put the
    // rebuild back — in SpatialIndex, before that system's phase.
    // Derived modifiers are computed from the Loadout and PlayerEffects
    // COMPONENTS, closing the window where a player existed both as an entity
    // and as a ServerPlayer read for modifier maths. Only the petal stat table
    // is still injected, and that is config, not state.
    (0, playerModifiers_2.registerPlayerModifierSystem)(playerScheduler, (0, playerModifiers_2.createPlayerModifierQueries)(world), {
        petalModifiersOf: (slot) => {
            // The gates match shared/playerModifiers.ts exactly: a slot only
            // contributes when it is a petal WITH a rarity — the legacy fold
            // skipped rarity-less items rather than defaulting to common.
            const item = slot;
            if (!item?.petalType || !item.rarity || item.type !== 'petal')
                return undefined;
            const stats = (0, petals_1.getPetalStats)(item.petalType, item.rarity);
            const modifiers = stats?.playerModifiers;
            if (!modifiers)
                return undefined;
            return {
                speedMultiplier: modifiers.speed,
                playerRadius: modifiers.playerRadius,
                magnetism: modifiers.magnetism,
                aggroRadius: modifiers.aggroRadius,
                rotationSpeed: modifiers.rotationSpeed,
            };
        },
        // The `speed_boost` effect fold from getSpeedMultiplier, over the
        // mirrored effect list. Multiplicative, speed_boost entries only.
        effectSpeedMultiplier: (effects) => {
            const list = effects;
            if (!list)
                return 1;
            let multiplier = 1;
            for (const effect of list) {
                if (effect.type === 'speed_boost' && effect.value !== undefined) {
                    multiplier *= effect.value;
                }
            }
            return multiplier;
        },
        primarySlotCount: playerModifiers_1.PRIMARY_LOADOUT_SLOTS,
    });
    // The legacy pipeline, under the scheduler. Registered as a system rather
    // than called from server.ts so it is phase-ordered and shows up in the
    // per-system timings alongside everything else.
    pipelineScheduler.add('playerPipeline', ecs_1.Phase.Simulation, (ctx) => {
        options.runPlayerPipeline(ctx.deltaTime, ctx.deltaMs, ctx.now);
    });
    // Petal interval behaviours (the PETAL_BEHAVIOURS table's onInterval
    // hooks) run right after the pipeline, exactly where the bare
    // updatePetalBehaviours() call sat in runSimulationStep.
    pipelineScheduler.add('petalBehaviours', ecs_1.Phase.Simulation, () => {
        options.runPetalBehaviours();
    });
    (0, playerMovement_1.registerPlayerMovementSystem)(playerScheduler, (0, playerMovement_1.createPlayerMovementQueries)(world), {
        maxSpeed: constants_1.MAX_SPEED,
        playerSize: constants_1.PLAYER_SIZE,
        // Passed through, never reimplemented — the client predicts with this
        // same function and any fork would desync open movement.
        step: constants_1.stepPlayerMovement,
    });
    // Projectile flight and collision live on the projectile scheduler, NOT the
    // mob one — see EcsRuntime.tickProjectiles for why that split exists.
    (0, movement_1.registerMovementSystems)(projectileScheduler, (0, movement_1.createMovementQueries)(world), {
        hitsWall: physics_1.checkProjectileWallCollision,
    });
    // Mobs that chase at exactly the player's base speed, so a fleeing flower
    // can never outrun them. Resolved to interned ids once, since the AI tests
    // this per chasing mob per tick.
    const playerSpeedChaserIds = new Set([
        'bee',
        'ladybug', 'shiny_ladybug', 'dark_ladybug',
        'soldier_ant', 'worker_ant', 'baby_ant',
        'soldier_fire_ant', 'worker_fire_ant', 'baby_fire_ant',
    ].map(name => interning_1.mobTypes.intern(name)));
    /** Resolve a mob entity's config from its interned type and rarity index. */
    const statsOf = (mob) => {
        const typeName = interning_1.mobTypes.nameOf(world.get(mob, C.MobKind, 'type'));
        const rarityName = (0, interning_1.idToRarity)(world.get(mob, C.MobKind, 'tier'));
        return rarityName ? (0, mobs_1.getMobStats)(typeName, rarityName) : null;
    };
    /**
     * Slow a mob: rarity contest against its tier, then the ECS write. The
     * legacy applySlow's two halves, with the config half kept here.
     */
    const applyMobSlow = (victim, baseFactor, until, sourceRarity, now) => {
        if (!world.has(victim, C.MobKind))
            return;
        const tierName = (0, interning_1.idToRarity)(world.get(victim, C.MobKind, 'tier')) ?? 'common';
        const factor = 1 - (1 - baseFactor) * (0, rarity_1.stallPower)(sourceRarity, tierName);
        (0, afflictions_1.applySlowToEntity)(world, victim, factor, until, now);
    };
    const fireVolley = (0, projectileFiring_1.createFireVolley)(world, {
        projectileConfigOf: (shooter) => statsOf(shooter)?.projectile,
        cooldownOf: (shooter) => statsOf(shooter)?.cooldown ?? 0,
        petalStatsOf: (petalType, rarityIndex) => {
            const rarityName = (0, interning_1.idToRarity)(rarityIndex);
            return rarityName ? ((0, petals_1.getPetalStats)(petalType, rarityName) ?? undefined) : undefined;
        },
        sizeScalingOf: (rarityIndex) => {
            const rarityName = (0, interning_1.idToRarity)(rarityIndex);
            return (rarityName ? mobs_1.SIZE_SCALING[rarityName] : undefined) ?? 1;
        },
        mobTypeNameOf: (shooter) => interning_1.mobTypes.nameOf(world.get(shooter, C.MobKind, 'type')),
        rarityNameOf: (rarityIndex) => (0, interning_1.idToRarity)(rarityIndex) ?? 'common',
        allocateNetId: () => options.allocateProjectileNetId(false),
    });
    const projectileQueries = (0, projectileCollision_1.createProjectileCollisionQueries)(world);
    (0, projectileCollision_1.registerProjectileCollisionSystem)(projectileScheduler, projectileQueries, grid, gridResult, {
        petalDamageOf: (petalType, rarityIndex) => {
            const rarityName = (0, interning_1.idToRarity)(rarityIndex);
            if (!rarityName)
                return undefined;
            return (0, petals_1.getPetalStats)(petalType, rarityName)?.damage;
        },
        massOf: (mob) => statsOf(mob)?.mass,
        playerRadiusOf: options.playerRadiusOf,
        damageMultiplierOf: options.damageMultiplierOf,
        onPlayerHit: options.onPlayerHit,
        creditDamage,
        emitEnemyDamaged: options.emitEnemyDamaged,
        markEnemyDamaged: onEnemyDamaged,
        onProjectileKill: options.onProjectileKill,
    });
    // Refreshed in Phase.SpatialIndex, i.e. before either consumer below runs.
    const activity = new lod_1.MobActivityField();
    (0, lod_1.registerMobActivitySystem)(scheduler, activity, (0, lod_1.createMobActivityQueries)(world));
    // Registered BEFORE the AI so slowExpiry (Phase.Input) restores a lapsed
    // slow before the chase logic reads Speed.current — the order the legacy
    // tick had (updateSlowEffects ran before moveEnemies). The poison systems
    // land in Phase.Combat ahead of mobCollision for the same reason: legacy
    // ticked poison before the melee pass.
    const afflictionQueries = (0, afflictions_1.createAfflictionQueries)(world);
    (0, afflictions_1.registerAfflictionSystems)(scheduler, afflictionQueries, {
        mobPoison: {
            creditDamage,
            markPoisonDamaged: options.onEnemyPoisonDamaged,
            onPoisonKill: options.onPoisonKill,
        },
        playerPoison: {
            tickPoison: options.tickPlayerPoison,
            onPoisonLapsed: options.onPlayerPoisonLapsed,
        },
    });
    (0, enemyAI_1.registerEnemyAISystem)(scheduler, (0, enemyAI_1.createEnemyAIQueries)(world), {
        hasLineOfSight: lineOfSight_1.hasLineOfSight,
        resolveWall: (x, y, halfSize) => (0, constants_1.resolveEntityWallCollisions)(x, y, halfSize),
        isBlocked: (x, y) => (0, constants_1.isTileIdBlocking)((0, constants_1.getTileState)(map_data_1.WALL_GRID, x, y)),
        fireVolley,
        hasProjectile: (shooter) => !!statsOf(shooter)?.projectile,
        isPlayerSpeedChaser: (typeId) => playerSpeedChaserIds.has(typeId),
        playerChaseStep: constants_1.MAX_SPEED / 30,
        sandstormSuckTier: (0, petals_1.getRarityIndex)('super'),
        maxTargetDistance: constants_1.VIEWPORT_WIDTH * 5,
        activity,
    });
    (0, mobCollision_1.registerMobCollisionSystem)(scheduler, (0, mobCollision_1.createMobCollisionQueries)(world), {
        resolveWall: (x, y, halfSize) => (0, constants_1.resolveEntityWallCollisions)(x, y, halfSize),
        noMobCollision: (mob) => !!statsOf(mob)?.no_mob_collision,
        creditDamage,
        onDamaged: onEnemyDamaged,
        onKilled: onEnemyKilled,
        activity,
    });
    (0, enemyPassive_1.registerEnemyPassiveSystems)(scheduler, (0, enemyPassive_1.createEnemyPassiveQueries)(world));
    // The centipede passes take the real tile-grid resolver, so a chain pushed
    // into geometry is corrected the same way every other wall contact is.
    (0, centipede_1.registerCentipedeSystems)(scheduler, (0, centipede_1.createCentipedeQueries)(world), (x, y, halfSize) => (0, constants_1.resolveEntityWallCollisions)(x, y, halfSize));
    // Feeds the unseen-despawn timer. Registered even while despawn itself is
    // legacy-owned, so ViewportTracked is accurate the moment lifecycle moves.
    (0, viewport_1.registerViewportSystem)(scheduler, (0, viewport_1.createViewportQueries)(world), {
        isNearAnyPlayer,
    });
    (0, lifetime_1.registerLifetimeSystems)(scheduler, (0, lifetime_1.createLifetimeQueries)(world), {
        // The exemptions despawnDistantEnemies used to check inline. Tier and
        // type are config knowledge, so the answer is composed here rather
        // than inside the ECS.
        neverDespawns: (mob) => {
            const tierName = (0, interning_1.idToRarity)(world.get(mob, C.MobKind, 'tier'));
            if (tierName === 'ultra' || tierName === 'super' || tierName === 'unique' || tierName === 'apex') {
                return true;
            }
            return interning_1.mobTypes.nameOf(world.get(mob, C.MobKind, 'type')) === 'target_dummy';
        },
        isProtectedAt: options.isDespawnProtectedAt,
        despawn: options.onMobDespawn,
        reap: options.onReapEnemy,
    });
    // Ground effects: pollen chip damage and web slows. On the world scheduler,
    // which the caller ticks straight after tickProjectiles so the grid rebuilt
    // there is current — see EcsRuntime.tickWorld for the ordering contract.
    (0, groundEffects_1.registerGroundEffectSystems)(worldScheduler, (0, groundEffects_1.createGroundEffectQueries)(world), grid, gridResult, {
        damageMultiplierOf: options.damageMultiplierOf,
        creditDamage,
        markEnemyDamaged: onEnemyDamaged,
        // Same legacy kill sequence projectiles use, with the same timing
        // the legacy pollen loop passed to killEnemy.
        onKill: (victim, killer) => options.onProjectileKill(victim, killer, 'sync-snapshot'),
        applySlow: (victim, baseFactor, until, rarityId, now) => applyMobSlow(victim, baseFactor, until, (0, interning_1.idToRarity)(rarityId) ?? 'common', now),
        emitExpired: options.onGroundEffectExpired,
        // The legacy pollen loop tested the mob's UNSCALED config radius,
        // not the tier-scaled entity radius; preserved exactly.
        pollenTargetRadiusOf: (victim) => {
            const stats = statsOf(victim);
            return stats ? (stats.size * 40) / 2 : constants_1.ENEMY_SIZE / 2;
        },
    });
    // Dropped items: wall push, bounds and expiry — the port of the legacy
    // updateWorldItems pass plus every per-item removal setTimeout.
    (0, droppedItems_1.registerDroppedItemSystems)(worldScheduler, (0, droppedItems_1.createDroppedItemQueries)(world), {
        resolveWall: (x, y) => (0, constants_1.resolveEntityWallCollisions)(x, y, droppedItems_1.DROPPED_ITEM_RADIUS),
        isOutOfBounds: options.isItemOutOfBounds,
        onRemoved: options.onWorldItemRemoved,
    });
    // Spawner triggers (queen-ant escorts, ant-hole waves). Phase.Spawning on
    // the world scheduler puts them after this tick's damage — projectile and
    // pollen included — exactly where the legacy spawnWaveMobs call sat.
    (0, spawning_1.registerSpawningSystems)(worldScheduler, (0, spawning_1.createSpawningQueries)(world), {
        spawnIntervalOf: (summoner) => statsOf(summoner)?.periodic_spawn?.intervalMs,
        spawnEscort: options.onSpawnEscort,
        waveCountOf: (parent) => (statsOf(parent)?.spawn_waves?.length ?? 0),
        spawnWaves: options.onSpawnWaves,
    });
    // ---------------------------------------------------------------------
    // The petal bridge
    // ---------------------------------------------------------------------
    // Petals are still legacy, so the one place the two halves have to meet is
    // "a petal blocked an incoming shot". Handles are snapshotted into a reused
    // buffer BEFORE any callback runs: the visit callback damages (and can
    // destroy) projectiles, and doing that while `chunks` is walking the
    // archetype would swap an unvisited row into the slot just passed.
    const blockScratch = [];
    const blockedView = { damage: 0 };
    return {
        world,
        scheduler,
        projectileScheduler,
        playerScheduler,
        inputScheduler,
        pipelineScheduler,
        worldScheduler,
        grid,
        gridResult,
        projectileQueries: {
            mob: projectileQueries.mobProjectiles,
            player: projectileQueries.playerProjectiles,
        },
        tick(deltaTime, deltaMs, now) {
            // The stamp table is indexed by entity slot, so it has to keep up
            // with the world as the population grows.
            grid.ensureStampCapacity(world.size() * 4 + 1024);
            scheduler.tick(deltaTime, deltaMs, now);
        },
        tickPlayers(deltaTime, deltaMs, now) {
            // No grid work here: nothing in the player pass queries the spatial
            // index. Player-vs-mob contact is still resolved by the legacy
            // collision block in updatePlayerState, against the legacy grid.
            playerScheduler.tick(deltaTime, deltaMs, now);
        },
        tickPlayerPipeline(deltaTime, deltaMs, now) {
            pipelineScheduler.tick(deltaTime, deltaMs, now);
        },
        tickInput(deltaTime, deltaMs, now) {
            // No grid work: the systems here read the LEGACY enemy grid, which
            // server.ts rebuilds immediately before this call. See tickInput's
            // declaration for why that ordering is the contract rather than an
            // accident.
            inputScheduler.tick(deltaTime, deltaMs, now);
        },
        tickProjectiles(deltaMs, now) {
            grid.ensureStampCapacity(world.size() * 4 + 1024);
            // Rebuilt here as well as in the mob tick. The legacy projectile
            // loops linear-scanned `enemies` and therefore saw POST-move mob
            // positions; the grid built at the top of the mob tick holds
            // pre-move ones. Refreshing it is what keeps hit tests landing where
            // the mobs actually are this tick.
            grid.rebuild(world, gridSource);
            projectileScheduler.tick(deltaMs / 1000, deltaMs, now);
        },
        tickWorld(deltaMs, now) {
            // No grid rebuild: the contract is that this runs straight after
            // tickProjectiles, whose rebuild is still current. A mob killed by
            // a projectile in between is still in the grid; the systems skip
            // it by its zeroed Health/IsDead, and the legacy-side hooks no-op
            // on a shell that has already left `enemies[]`.
            worldScheduler.tick(deltaMs / 1000, deltaMs, now);
        },
        slowEnemy: applyMobSlow,
        poisonEnemy(victim, source, damagePerMs, endTime) {
            (0, afflictions_1.applyPoisonStack)(world, afflictionQueries.poisonStacks, victim, source, damagePerMs, endTime);
        },
        spawnPlayerProjectile(spec) {
            const shooter = options.resolvePlayerEntity(spec.playerId);
            if (shooter === undefined)
                return;
            (0, prefabs_1.spawnProjectile)(world, {
                x: spec.x,
                y: spec.y,
                angle: spec.angle,
                speed: spec.speed,
                maxDistance: spec.maxDistance,
                damage: spec.damage,
                health: spec.health,
                size: spec.size,
                petalType: spec.petalType,
                petalRarity: spec.petalRarity,
                shooter,
                // Player projectiles carry no mob source type: nothing reads one
                // (glitch infection is a mob-projectile rule).
                fromPlayer: true,
                netId: options.allocateProjectileNetId(true),
                now: spec.now,
            });
        },
        forEachMobProjectileHitting(x, y, petalRadius, visit) {
            blockScratch.length = 0;
            projectileQueries.mobProjectiles.chunks(chunk => {
                const pos = chunk.cols(C.Position);
                const rad = chunk.cols(C.Radius);
                const hp = chunk.cols(C.Health);
                const entities = chunk.entities;
                for (let i = 0; i < chunk.count; i++) {
                    if (hp.current[i] <= 0)
                        continue;
                    const dx = pos.x[i] - x;
                    const dy = pos.y[i] - y;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    // `distance > 0` matches the legacy petal test exactly.
                    if (!(distance < rad.value[i] + petalRadius && distance > 0))
                        continue;
                    blockScratch.push(entities[i]);
                }
            });
            for (let i = 0; i < blockScratch.length; i++) {
                const projectile = blockScratch[i];
                if (!world.isAlive(projectile))
                    continue;
                // Damage the petal takes: re-looked-up from the petal table with
                // the stamped value as the fallback, exactly as before.
                const typeName = interning_1.petalTypes.nameOf(world.get(projectile, C.Projectile, 'petalType'));
                const rarityName = (0, interning_1.idToRarity)(world.get(projectile, C.Projectile, 'petalRarity'));
                const stats = rarityName ? (0, petals_1.getPetalStats)(typeName, rarityName) : null;
                blockedView.damage = stats
                    ? stats.damage
                    : world.get(projectile, C.Damage, 'value');
                const dealt = visit(blockedView);
                const health = world.get(projectile, C.Health, 'current') - dealt;
                world.set(projectile, C.Health, 'current', health);
                if (health <= 0)
                    world.destroy(projectile);
            }
            blockScratch.length = 0;
        },
    };
}
