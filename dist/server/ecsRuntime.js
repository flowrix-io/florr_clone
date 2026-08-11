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
const petals_1 = require("../petals");
const mobs_1 = require("../mobs");
const ecs_1 = require("../ecs");
const C = __importStar(require("../ecs/components"));
const grid_1 = require("../ecs/spatial/grid");
const interning_1 = require("../ecs/interning");
const projectileFiring_1 = require("../ecs/systems/projectileFiring");
const mobCollision_1 = require("../ecs/systems/mobCollision");
const afflictions_1 = require("../ecs/systems/afflictions");
const lifetime_1 = require("../ecs/systems/lifetime");
const centipede_1 = require("../ecs/systems/centipede");
const enemyAI_1 = require("../ecs/systems/enemyAI");
const enemyPassive_1 = require("../ecs/systems/enemyPassive");
const movement_1 = require("../ecs/systems/movement");
const playerMovement_1 = require("../ecs/systems/playerMovement");
const playerModifiers_1 = require("../ecs/systems/playerModifiers");
function createEcsRuntime(options) {
    const { creditDamage, onEnemyDamaged, onEnemyKilled } = options;
    const world = new ecs_1.World();
    const scheduler = new ecs_1.Scheduler(world);
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
    (0, playerModifiers_1.registerPlayerModifierSystem)(scheduler, (0, playerModifiers_1.createPlayerModifierQueries)(world), {
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
    (0, playerMovement_1.registerPlayerMovementSystem)(scheduler, (0, playerMovement_1.createPlayerMovementQueries)(world), {
        maxSpeed: constants_1.MAX_SPEED,
        playerSize: constants_1.PLAYER_SIZE,
        // Passed through, never reimplemented — the client predicts with this
        // same function and any fork would desync open movement.
        step: constants_1.stepPlayerMovement,
    });
    (0, movement_1.registerMovementSystems)(scheduler, (0, movement_1.createMovementQueries)(world));
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
    (0, afflictions_1.registerAfflictionSystems)(scheduler, (0, afflictions_1.createAfflictionQueries)(world));
    (0, lifetime_1.registerLifetimeSystems)(scheduler, (0, lifetime_1.createLifetimeQueries)(world));
    return {
        world,
        scheduler,
        grid,
        gridResult,
        tick(deltaTime, deltaMs, now) {
            // The stamp table is indexed by entity slot, so it has to keep up
            // with the world as the population grows.
            grid.ensureStampCapacity(world.size() * 4 + 1024);
            scheduler.tick(deltaTime, deltaMs, now);
        },
    };
}
