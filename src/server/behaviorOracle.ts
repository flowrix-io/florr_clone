/*
 * Machine-readable behavioral oracle for the native server.
 *
 * Keep this module side-effect free: the parity runner executes it in a fresh
 * process and compares every emitted observation with the C++ ECS server's
 * probe.  Each line is a JSON tuple so content ids can safely contain any
 * punctuation without inventing an escaping convention.
 */
import '../map_data'; // Populate constants.WALL_GRID exactly as the live TS server does.
import { getAllMobTypes, getMobStats, RARITY_LEVELS as MOB_RARITIES } from '../mobs';
import {
    getAllPetalTypes,
    getEffectivePetalCooldown,
    getPetalStats,
    RARITY_LEVELS as PETAL_RARITIES,
} from '../petals';
import {
    RARITY_ORDER,
    getCraftingChance,
    getDropDowngradeChance,
    getDropUpgradeChance,
    stallPower,
} from './shared/rarity';
import { calculatePlayerModifiers } from './shared/playerModifiers';
import { ServerPlayer } from '../player';
import { World } from '../ecs/world';
import * as C from '../ecs/components';
import { damageMob } from './mobFields';
import {
    PlayerMoveState, stepPlayerMovement, WALL_GRID, getTileState,
    resolveEntityWallCollisions,
} from '../constants';

type Metric = number | string | boolean;

function emit(path: string, value: Metric): void {
    process.stdout.write(`${JSON.stringify([path, value])}\n`);
}

function numberOr(value: number | undefined | null, fallback: number): number {
    return value === undefined || value === null ? fallback : value;
}

function sectionMask(sections: number[]): number {
    let mask = 0;
    for (const section of sections) {
        if (section >= 0 && section < 9) mask |= 1 << section;
    }
    return mask;
}

for (let i = 0; i < RARITY_ORDER.length; i++) {
    const rarity = RARITY_ORDER[i];
    emit(`rarity/${rarity}/craft-percent`, getCraftingChance(i));
    emit(`rarity/${rarity}/drop-upgrade-percent`, getDropUpgradeChance(rarity));
    emit(`rarity/${rarity}/drop-downgrade-fraction`, getDropDowngradeChance(rarity));
    for (const target of RARITY_ORDER) {
        emit(`rarity/${rarity}/stall/${target}`, stallPower(rarity, target));
    }
}

for (const mobType of getAllMobTypes()) {
    for (const rarity of MOB_RARITIES) {
        const stats = getMobStats(mobType, rarity);
        if (!stats) throw new Error(`missing TypeScript mob stats: ${mobType}/${rarity}`);
        const prefix = `mob/${mobType}/${rarity}`;
        emit(`${prefix}/health`, stats.health);
        emit(`${prefix}/damage`, stats.damage);
        emit(`${prefix}/radius`, stats.size * 20);
        emit(`${prefix}/mass`, stats.mass);
        emit(`${prefix}/xp`, stats.xp);
        emit(`${prefix}/aggro-range`, stats.range);
        emit(`${prefix}/attack-cooldown-ms`, stats.cooldown);
        emit(`${prefix}/poison-per-second`, numberOr(stats.poison, 0) * 1000);
        emit(`${prefix}/poison-duration-ms`, numberOr(stats.poisonDuration, 0));
        emit(`${prefix}/visual-scale`, numberOr(stats.visual_scale, 1));
        emit(`${prefix}/spawn-weight`, stats.spawn_weight);
        emit(`${prefix}/ai`, stats.ai_type);
        emit(`${prefix}/section-mask`, sectionMask(stats.section));
    }
}

for (const petalType of getAllPetalTypes()) {
    for (const rarity of PETAL_RARITIES) {
        const stats = getPetalStats(petalType, rarity);
        if (!stats) throw new Error(`missing TypeScript petal stats: ${petalType}/${rarity}`);
        const prefix = `petal/${petalType}/${rarity}`;
        const modifiers = stats.playerModifiers;
        emit(`${prefix}/damage`, stats.damage);
        emit(`${prefix}/health`, stats.health);
        emit(`${prefix}/reload-ms`, getEffectivePetalCooldown(petalType, rarity, stats));
        emit(`${prefix}/poison-per-second`, numberOr(stats.poison, 0) * 1000);
        emit(`${prefix}/poison-duration-ms`, numberOr(stats.poisonDuration, 0));
        emit(`${prefix}/burst-heal`, numberOr(stats.burstHeal, 0));
        emit(`${prefix}/burst-heal-charge-ms`, numberOr(stats.burstHealChargeMs, 0));
        emit(`${prefix}/passive-heal-per-second`, numberOr(stats.passiveHeal, 0));
        emit(`${prefix}/knockback`, numberOr(stats.knockback, 5));
        emit(`${prefix}/shield`, numberOr(stats.burstShield, 0));
        emit(`${prefix}/slow-factor`, numberOr(stats.slowFactor, 1));
        emit(`${prefix}/slow-duration-ms`, numberOr(stats.slowDuration, 0));
        emit(`${prefix}/web-radius`, numberOr(stats.webRadius, 0));
        emit(`${prefix}/sponge-duration-ms`, numberOr(stats.spongeDamageDuration, 0));
        emit(`${prefix}/attraction-force`, numberOr(stats.attractionForce, 0));
        emit(`${prefix}/size`, stats.size);
        emit(`${prefix}/count`, numberOr(stats.count, 1));
        emit(`${prefix}/camera-zoom`, numberOr(stats.cameraZoom, 1));
        emit(`${prefix}/modifier/damage`, numberOr(modifiers?.damage, 1));
        emit(`${prefix}/modifier/max-health`, numberOr(modifiers?.maxHealth, 1));
        emit(`${prefix}/modifier/speed`, numberOr(modifiers?.speed, 1));
        emit(`${prefix}/modifier/range`, numberOr(modifiers?.range, 1));
        emit(`${prefix}/modifier/rotation-speed`, numberOr(modifiers?.rotationSpeed, 1));
        emit(`${prefix}/modifier/player-radius`, numberOr(modifiers?.playerRadius, 1));
        emit(`${prefix}/modifier/luck`, numberOr(modifiers?.luck, 0));
        emit(`${prefix}/modifier/magnetism`, numberOr(modifiers?.magnetism, 0));
        emit(`${prefix}/modifier/aggro-radius`, numberOr(modifiers?.aggroRadius, 0));
        emit(`${prefix}/modifier/petal-attraction-radius`, numberOr(modifiers?.petalAttractionRadius, 0));
        emit(`${prefix}/modifier/poison-armor`, numberOr(modifiers?.poisonArmor, 0));
    }
}

const modifierScenarios: Array<{ name: string; loadout: Array<[string, string] | null> }> = [
    { name: 'empty', loadout: [] },
    {
        name: 'mixed-active',
        loadout: [
            ['faster', 'rare'], ['powder', 'epic'], ['soil', 'legendary'],
            ['air', 'uncommon'], ['clover', 'mythic'], ['lotus', 'ultra'],
            ['lentil', 'super'], ['basic', 'common'], null, ['faster', 'common'],
        ],
    },
    {
        name: 'storage-ignored',
        loadout: [
            ['basic', 'common'], null, null, null, null, null, null, null, null, null,
            ['faster', 'apex'], ['soil', 'apex'], ['clover', 'apex'], ['lentil', 'apex'],
        ],
    },
];

for (const scenario of modifierScenarios) {
    const loadout = scenario.loadout.map(item => item === null ? null : ({
        type: 'petal', petalType: item[0], rarity: item[1],
    }));
    const modifiers = calculatePlayerModifiers({ loadout } as unknown as ServerPlayer);
    const prefix = `scenario/modifiers/${scenario.name}`;
    emit(`${prefix}/damage`, numberOr(modifiers.damage, 1));
    emit(`${prefix}/max-health`, numberOr(modifiers.maxHealth, 1));
    emit(`${prefix}/speed`, numberOr(modifiers.speed, 1));
    emit(`${prefix}/range`, numberOr(modifiers.range, 1));
    emit(`${prefix}/rotation-speed`, numberOr(modifiers.rotationSpeed, 1));
    emit(`${prefix}/player-radius`, numberOr(modifiers.playerRadius, 1));
    emit(`${prefix}/luck`, numberOr(modifiers.luck, 1));
    emit(`${prefix}/magnetism`, numberOr(modifiers.magnetism, 0));
    emit(`${prefix}/aggro-radius`, numberOr(modifiers.aggroRadius, 0));
    emit(`${prefix}/petal-attraction-radius`, numberOr(modifiers.petalAttractionRadius, 30));
    emit(`${prefix}/poison-armor`, numberOr(modifiers.poisonArmor, 0));
}

// Drive the real ECS health writer, including glitch's intentionally negative
// damage.  This catches semantic differences that matching stat tables alone
// cannot: TypeScript negative mob damage heals and may exceed the old health.
{
    const world = new World();
    const mob = world.create();
    world.add(mob, C.Health, { current: 100, max: 100 });
    emit('scenario/mob-health/positive-hit', damageMob(mob, 30, world));
    emit('scenario/mob-health/negative-hit', damageMob(mob, -10, world));
    emit('scenario/mob-health/lethal-hit', damageMob(mob, 500, world));
    emit('scenario/mob-health/dead', world.has(mob, C.IsDead));
}

// Run the authoritative TypeScript movement step at the production 30 Hz.
// The chosen garden patch is open in the shared map, so this isolates input,
// friction, integration, body-size handling, and coast-down.
{
    const samples: Array<[string, number, number]> = [
        ['center', 3000, 3000], ['above', 3000, 2990], ['below', 3000, 3010],
        ['right', 3070, 3000], ['upper-right', 3070, 2990],
    ];
    for (const [name, x, y] of samples) {
        emit(`scenario/movement/tile/${name}`, getTileState(WALL_GRID, x, y));
    }
    const resolvedStart = resolveEntityWallCollisions(3000, 2940, 20);
    emit('scenario/movement/resolve-start/x', resolvedStart.x);
    emit('scenario/movement/resolve-start/y', resolvedStart.y);
    let state: PlayerMoveState = { x: 3000, y: 2940, vx: 0, vy: 0 };
    const dt = 1 / 30;
    const phases: Array<[string, number, number]> = [
        ['wall-slide', 300 / Math.sqrt(2), 300 / Math.sqrt(2)],
        ['half-up', 0, -150],
        ['release', 0, 0],
    ];
    for (const [name, targetVX, targetVY] of phases) {
        for (let tick = 0; tick < 10; tick++) {
            state = stepPlayerMovement(state, targetVX, targetVY, dt, 40);
            emit(`scenario/movement/${name}/tick-${tick + 1}/x`, state.x);
            emit(`scenario/movement/${name}/tick-${tick + 1}/y`, state.y);
            emit(`scenario/movement/${name}/tick-${tick + 1}/vx`, state.vx);
            emit(`scenario/movement/${name}/tick-${tick + 1}/vy`, state.vy);
        }
        emit(`scenario/movement/${name}/x`, state.x);
        emit(`scenario/movement/${name}/y`, state.y);
        emit(`scenario/movement/${name}/vx`, state.vx);
        emit(`scenario/movement/${name}/vy`, state.vy);
    }
}
