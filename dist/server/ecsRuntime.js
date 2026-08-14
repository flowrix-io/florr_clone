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
const lifetime_1 = require("../ecs/systems/lifetime");
const centipede_1 = require("../ecs/systems/centipede");
const enemyAI_1 = require("../ecs/systems/enemyAI");
const enemyPassive_1 = require("../ecs/systems/enemyPassive");
const movement_1 = require("../ecs/systems/movement");
const viewport_1 = require("../ecs/systems/viewport");
const playerMovement_1 = require("../ecs/systems/playerMovement");
const playerModifiers_1 = require("../ecs/systems/playerModifiers");
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
    const grid = new grid_1.SpatialGrid();
    const gridResult = new grid_1.GridQueryResult(256);
    /**
     * The grid is fed by the same predicate the old rebuild used: wild, living
     * mobs only. Pets are excluded because callers of the broad phase expect not
     * to have to filter them, and the dead because they are pending reaping.
     */
    const gridSource = world.query([C.Position, C.Radius, C.IsEnemy], [C.IsDead, C.PetOwner]);
    // Spatial index first: bot targeting queries it, exactly as before.
    scheduler.add('rebuildSpatialGrid', ecs_1.Phase.SpatialIndex, () => {
        grid.rebuild(world, gridSource);
    });
    // Derived modifiers are computed from the Loadout and PlayerEffects
    // COMPONENTS, closing the window where a player existed both as an entity
    // and as a ServerPlayer read for modifier maths. Only the petal stat table
    // is still injected, and that is config, not state.
    (0, playerModifiers_1.registerPlayerModifierSystem)(playerScheduler, (0, playerModifiers_1.createPlayerModifierQueries)(world), {
        petalModifiersOf: (slot) => {
            const item = slot;
            if (!item?.petalType)
                return undefined;
            const stats = (0, petals_1.getPetalStats)(item.petalType, item.rarity ?? 'common');
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
        // Active speed effects still come from the legacy effect pipeline; the
        // effect LIST itself is already a component, so this reads component
        // state through a config-only helper.
        effectSpeedMultiplier: () => 1,
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
    });
    (0, mobCollision_1.registerMobCollisionSystem)(scheduler, (0, mobCollision_1.createMobCollisionQueries)(world), {
        resolveWall: (x, y, halfSize) => (0, constants_1.resolveEntityWallCollisions)(x, y, halfSize),
        noMobCollision: (mob) => !!statsOf(mob)?.no_mob_collision,
        creditDamage,
        onDamaged: onEnemyDamaged,
        onKilled: onEnemyKilled,
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
    (0, afflictions_1.registerAfflictionSystems)(scheduler, (0, afflictions_1.createAfflictionQueries)(world));
    (0, lifetime_1.registerLifetimeSystems)(scheduler, (0, lifetime_1.createLifetimeQueries)(world));
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
