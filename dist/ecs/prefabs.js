"use strict";
/**
 * Entity factories.
 *
 * These replace the scattered construction sites the old code had — the ten
 * different `Enemy` object literals that `makeEnemy()` was introduced to
 * normalise, the two projectile push sites, the player-object builds in
 * authenticate/respawn.
 *
 * A prefab decides an entity's ARCHETYPE, which is the thing worth centralising:
 * it is what every query matches on, and it is cheap to get subtly wrong (a bee
 * built without ViewportTracked simply never despawns, and nothing errors). Any
 * entity of a given kind should come out of here so that kind has exactly one
 * shape.
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
exports.spawnMob = spawnMob;
exports.makePet = makePet;
exports.spawnProjectile = spawnProjectile;
exports.spawnPlayer = spawnPlayer;
exports.spawnGroundPollen = spawnGroundPollen;
exports.spawnWebField = spawnWebField;
exports.spawnObstacle = spawnObstacle;
const C = __importStar(require("./components"));
const entity_1 = require("./entity");
const interning_1 = require("./interning");
/**
 * A wild mob.
 *
 * Deliberately does NOT add the optional behaviour components (Wander, Wobble,
 * PassiveMotion, HoleTether, PetOwner, CentipedeSegment, DpsTracker...). Those
 * are added by the spawner for the mob types that actually use them, so a bee's
 * archetype stays narrow and the AI passes iterate only mobs that can wander.
 */
function spawnMob(world, spec) {
    const e = world.create();
    world.bindExternalId(e, spec.id);
    world.add(e, C.Position, { x: spec.x, y: spec.y });
    world.add(e, C.Velocity, { x: 0, y: 0 });
    world.add(e, C.Angle, { value: spec.angle ?? 0 });
    world.add(e, C.Radius, { value: spec.radius });
    world.add(e, C.Speed, { current: spec.speed, base: spec.speed });
    world.add(e, C.Health, { current: spec.health, max: spec.maxHealth });
    world.add(e, C.Damage, { value: spec.damage });
    world.add(e, C.MobKind, {
        type: interning_1.mobTypes.intern(spec.type),
        tier: (0, interning_1.rarityToId)(spec.tier),
    });
    world.add(e, C.MobAI, {
        aiType: spec.aiType ?? 1 /* C.AiType.Neutral */,
        isChasing: 0,
        targetPlayer: entity_1.NULL_ENTITY,
        targetEnemy: entity_1.NULL_ENTITY,
        targetPet: entity_1.NULL_ENTITY,
        range: spec.range ?? 0,
    });
    world.add(e, C.SpawnTime, { at: spec.now });
    world.add(e, C.ViewportTracked, { lastInViewport: spec.now });
    world.add(e, C.GridStamps, { collisionStamp: 0, queryStamp: 0 });
    if (spec.stats !== undefined)
        world.add(e, C.MobStats, { stats: spec.stats });
    world.add(e, C.IsEnemy);
    return e;
}
/** Turn an already-spawned mob into somebody's pet. */
function makePet(world, mob, owner, image) {
    world.add(mob, C.PetOwner, { owner, image: image ?? '' });
}
/**
 * A projectile.
 *
 * Mob and player projectiles share this one archetype apart from the FromPlayer
 * tag, so the flight integration and the expiry sweep are written once rather
 * than duplicated across two arrays and two loops as before.
 *
 * `sourceType`/`sourceTier` are stamped here rather than resolved from
 * `shooter` on impact, because the shooter is frequently already dead and
 * despawned by the time the projectile lands.
 */
function spawnProjectile(world, spec) {
    const e = world.create();
    world.add(e, C.Position, { x: spec.x, y: spec.y });
    world.add(e, C.Angle, { value: spec.angle });
    world.add(e, C.Speed, { current: spec.speed, base: spec.speed });
    world.add(e, C.Health, { current: spec.health, max: spec.health });
    world.add(e, C.Damage, { value: spec.damage });
    world.add(e, C.Radius, { value: spec.size * 20 / 2 });
    world.add(e, C.Projectile, {
        startX: spec.x,
        startY: spec.y,
        distance: 0,
        maxDistance: spec.maxDistance,
        petalType: interning_1.petalTypes.intern(spec.petalType),
        petalRarity: (0, interning_1.rarityToId)(spec.petalRarity),
        size: spec.size,
    });
    world.add(e, C.ProjectileOrigin, {
        shooter: spec.shooter,
        sourceType: spec.sourceType === undefined ? 0xffff : interning_1.mobTypes.intern(spec.sourceType),
        sourceTier: spec.sourceTier === undefined ? 0 : (0, interning_1.rarityToId)(spec.sourceTier),
    });
    world.add(e, C.ProjectileSync, { spawnTime: spec.now, lastSyncTime: spec.now });
    world.add(e, C.IsProjectile);
    if (spec.fromPlayer)
        world.add(e, C.FromPlayer);
    return e;
}
/**
 * A player.
 *
 * When `lobby` is set the entity gets the IsLobby tag, which every world query
 * excludes. That reproduces the guarantee the old separate `lobbyPlayers` map
 * provided structurally: a title-screen flower cannot be simulated, targeted,
 * saved or broadcast by a system that did not explicitly ask for lobby players.
 */
function spawnPlayer(world, spec) {
    const e = world.create();
    world.bindExternalId(e, spec.socketId);
    world.add(e, C.Position, { x: spec.x, y: spec.y });
    world.add(e, C.Velocity, { x: 0, y: 0 });
    world.add(e, C.Angle, { value: 0 });
    world.add(e, C.Radius, { value: spec.radius });
    world.add(e, C.Health, { current: spec.health, max: spec.maxHealth });
    world.add(e, C.Damage, { value: spec.damage });
    world.add(e, C.PlayerIdentity, { name: spec.name, userId: spec.userId ?? '' });
    world.add(e, C.PlayerInput, {
        seq: 0,
        lastProcessedSeq: 0,
        keys: [],
        useMouse: 0,
        mouseDirectionX: 0,
        mouseDirectionY: 0,
        mouseSpeedMultiplier: 1,
        petalExtension: 0,
    });
    world.add(e, C.PlayerModifiers, {
        speedBoost: 1,
        speedFactor: 1,
        sizeMultiplier: 1,
        magnetism: 0,
        aggroRadiusBonus: 0,
        petalOrbitPhase: 0,
    });
    world.add(e, C.Inventory, { items: spec.inventory });
    world.add(e, C.Loadout, { slots: spec.loadout });
    world.add(e, C.SpawnTime, { at: spec.now });
    world.add(e, C.IsPlayer);
    if (spec.lobby)
        world.add(e, C.IsLobby);
    if (spec.bot)
        world.add(e, C.IsBot);
    return e;
}
/** A pollen puff left on the ground when a pollen petal breaks. */
function spawnGroundPollen(world, spec) {
    const e = world.create();
    world.add(e, C.Position, { x: spec.x, y: spec.y });
    world.add(e, C.Radius, { value: spec.radius });
    world.add(e, C.GroundPollen, {
        owner: spec.owner,
        damage: spec.damage,
        rarity: (0, interning_1.rarityToId)(spec.rarity),
        lastDamageByEnemy: new Map(),
    });
    world.add(e, C.Expires, { at: spec.expiresAt });
    world.add(e, C.IsGroundEffect);
    return e;
}
/** A web field: a stationary zone that halves the speed of anything inside it. */
function spawnWebField(world, spec) {
    const e = world.create();
    world.add(e, C.Position, { x: spec.x, y: spec.y });
    world.add(e, C.Radius, { value: spec.radius });
    world.add(e, C.WebField, { owner: spec.owner, rarity: (0, interning_1.rarityToId)(spec.rarity) });
    world.add(e, C.Expires, { at: spec.expiresAt });
    world.add(e, C.IsGroundEffect);
    return e;
}
/** A static wall. Position is the top-left corner, matching the old Obstacle. */
function spawnObstacle(world, spec) {
    const e = world.create();
    world.add(e, C.Position, { x: spec.x, y: spec.y });
    world.add(e, C.Box, { width: spec.width, height: spec.height });
    world.add(e, C.IsObstacle);
    return e;
}
