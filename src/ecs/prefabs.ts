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

import * as C from './components';
import { Entity, NULL_ENTITY } from './entity';
import { mobTypes, petalTypes, rarityToId } from './interning';
import { PetalRingState } from './systems/petalRing';
import { World } from './world';

export interface MobSpawn {
    /** Stable string id, bound as the entity's external id for the wire layer. */
    id: string;
    type: string;
    tier: string;
    x: number;
    y: number;
    angle?: number;
    health: number;
    maxHealth: number;
    speed: number;
    damage: number;
    radius: number;
    aiType?: C.AiType;
    range?: number;
    /** Shared immutable getMobStats() result. */
    stats?: unknown;
    now: number;
}

/**
 * A wild mob.
 *
 * Deliberately does NOT add the optional behaviour components (Wander, Wobble,
 * PassiveMotion, HoleTether, PetOwner, CentipedeSegment, DpsTracker...). Those
 * are added by the spawner for the mob types that actually use them, so a bee's
 * archetype stays narrow and the AI passes iterate only mobs that can wander.
 */
export function spawnMob(world: World, spec: MobSpawn): Entity {
    const e = world.create();
    world.bindExternalId(e, spec.id);

    world.add(e, C.Position, { x: spec.x, y: spec.y });
    world.add(e, C.Velocity, { x: 0, y: 0 });
    // Unconditional, though most mobs are never knocked back. Adding it lazily
    // on first impact moved the mob to a different ARCHETYPE mid-tick, which
    // meant a structural change (and therefore a deferral queue in syncToEcs)
    // on the first hit of every mob's life. Eight bytes per mob buys that away
    // and keeps the mob archetype stable for its whole life.
    world.add(e, C.Knockback, { x: 0, y: 0 });
    world.add(e, C.Angle, { value: spec.angle ?? 0 });
    world.add(e, C.Radius, { value: spec.radius });
    world.add(e, C.Speed, { current: spec.speed, base: spec.speed });
    world.add(e, C.Health, { current: spec.health, max: spec.maxHealth });
    world.add(e, C.Damage, { value: spec.damage });
    world.add(e, C.MobKind, {
        type: mobTypes.intern(spec.type),
        tier: rarityToId(spec.tier),
    });
    world.add(e, C.MobAI, {
        aiType: spec.aiType ?? C.AiType.Neutral,
        isChasing: 0,
        targetPlayer: NULL_ENTITY,
        targetEnemy: NULL_ENTITY,
        targetPet: NULL_ENTITY,
        range: spec.range ?? 0,
    });
    world.add(e, C.SpawnTime, { at: spec.now });
    world.add(e, C.ViewportTracked, { lastInViewport: spec.now });
    world.add(e, C.GridStamps, { collisionStamp: 0, queryStamp: 0 });
    if (spec.stats !== undefined) world.add(e, C.MobStats, { stats: spec.stats });
    world.add(e, C.IsEnemy);
    return e;
}

/** Turn an already-spawned mob into somebody's pet. */
export function makePet(world: World, mob: Entity, owner: Entity, image?: string): void {
    world.add(mob, C.PetOwner, { owner, image: image ?? '' });
}

export interface ProjectileSpawn {
    x: number;
    y: number;
    angle: number;
    /** Pixels per MILLISECOND, matching the existing projectile speed units. */
    speed: number;
    maxDistance: number;
    damage: number;
    health: number;
    size: number;
    petalType: string;
    petalRarity: string;
    /** The mob or player that fired it. */
    shooter: Entity;
    /** Interned-on-spawn shooter type, since the shooter may die mid-flight. */
    sourceType?: string;
    sourceTier?: string;
    /** True for player-fired projectiles. */
    fromPlayer: boolean;
    /**
     * Wire id, minted by the caller from the monotonic per-kind counter.
     *
     * Required rather than derived: the entity handle is recycled and must never
     * reach a client, so every spawn site has to go and get a real id.
     */
    netId: number;
    now: number;
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
export function spawnProjectile(world: World, spec: ProjectileSpawn): Entity {
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
        petalType: petalTypes.intern(spec.petalType),
        petalRarity: rarityToId(spec.petalRarity),
        size: spec.size,
    });
    world.add(e, C.ProjectileOrigin, {
        shooter: spec.shooter,
        sourceType: spec.sourceType === undefined ? 0xffff : mobTypes.intern(spec.sourceType),
        sourceTier: spec.sourceTier === undefined ? 0 : rarityToId(spec.sourceTier),
    });
    world.add(e, C.ProjectileSync, { spawnTime: spec.now, lastSyncTime: spec.now });
    world.add(e, C.NetId, { id: spec.netId });
    world.add(e, C.IsProjectile);
    if (spec.fromPlayer) world.add(e, C.FromPlayer);
    return e;
}

export interface PlayerSpawn {
    /** Socket id, bound as the external id. */
    socketId: string;
    name: string;
    userId?: string;
    x: number;
    y: number;
    health: number;
    maxHealth: number;
    damage: number;
    radius: number;
    inventory: unknown;
    loadout: unknown;
    /** True while the player is on the title screen and not yet in the world. */
    lobby?: boolean;
    bot?: boolean;
    now: number;
}

/**
 * A player.
 *
 * When `lobby` is set the entity gets the IsLobby tag, which every world query
 * excludes. That reproduces the guarantee the old separate `lobbyPlayers` map
 * provided structurally: a title-screen flower cannot be simulated, targeted,
 * saved or broadcast by a system that did not explicitly ask for lobby players.
 */
export function spawnPlayer(world: World, spec: PlayerSpawn): Entity {
    const e = world.create();
    world.bindExternalId(e, spec.socketId);

    world.add(e, C.Position, { x: spec.x, y: spec.y });
    world.add(e, C.Velocity, { x: 0, y: 0 });
    // Unconditional, though most mobs are never knocked back. Adding it lazily
    // on first impact moved the mob to a different ARCHETYPE mid-tick, which
    // meant a structural change (and therefore a deferral queue in syncToEcs)
    // on the first hit of every mob's life. Eight bytes per mob buys that away
    // and keeps the mob archetype stable for its whole life.
    world.add(e, C.Knockback, { x: 0, y: 0 });
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
        speedBoostBase: 1,
        speedFactor: 1,
        sizeMultiplier: 1,
        magnetism: 0,
        aggroRadiusBonus: 0,
        petalOrbitPhase: 0,
    });
    world.add(e, C.Inventory, { items: spec.inventory });
    world.add(e, C.Loadout, { slots: spec.loadout });
    // Given at birth rather than on the flower's first petal tick, so every
    // player has ONE archetype instead of splitting into "has orbited" and
    // "has not". A ring with no petals in it is an empty Map.
    world.add(e, C.PetalRing, { state: new PetalRingState(), slotCount: 0 });
    world.add(e, C.SpawnTime, { at: spec.now });
    world.add(e, C.IsPlayer);
    if (spec.lobby) world.add(e, C.IsLobby);
    if (spec.bot) world.add(e, C.IsBot);
    return e;
}

/** A pollen puff left on the ground when a pollen petal breaks. */
export function spawnGroundPollen(
    world: World,
    spec: { id: string; x: number; y: number; owner: Entity; damage: number; radius: number; rarity: string; expiresAt: number },
): Entity {
    const e = world.create();
    // The wire id: clients receive it in `groundPollenSpawned` and the expiry
    // system reads it back for `groundPollenRemoved`.
    world.bindExternalId(e, spec.id);
    world.add(e, C.Position, { x: spec.x, y: spec.y });
    world.add(e, C.Radius, { value: spec.radius });
    world.add(e, C.GroundPollen, {
        owner: spec.owner,
        damage: spec.damage,
        rarity: rarityToId(spec.rarity),
        lastDamageByEnemy: new Map<number, number>(),
    });
    world.add(e, C.Expires, { at: spec.expiresAt });
    world.add(e, C.IsGroundEffect);
    return e;
}

/** A web field: a stationary zone that halves the speed of anything inside it. */
export function spawnWebField(
    world: World,
    spec: { id: string; x: number; y: number; owner: Entity; radius: number; rarity: string; expiresAt: number },
): Entity {
    const e = world.create();
    // The wire id, as for pollen: emitted back on expiry as `webRemoved`.
    world.bindExternalId(e, spec.id);
    world.add(e, C.Position, { x: spec.x, y: spec.y });
    world.add(e, C.Radius, { value: spec.radius });
    world.add(e, C.WebField, { owner: spec.owner, rarity: rarityToId(spec.rarity) });
    world.add(e, C.Expires, { at: spec.expiresAt });
    world.add(e, C.IsGroundEffect);
    return e;
}

export interface DroppedItemSpawn {
    /** The wire id (`WorldItem.id`), bound as the external id. */
    id: string;
    x: number;
    y: number;
    /** Interned petal type, or 0xffff for a non-petal pickup. */
    petalType: number;
    rarity: string;
    kind: C.ItemKind;
    /** string[] of player ids allowed to pick this up, or undefined for anyone. */
    eligiblePlayers: unknown;
    /** Set<string> of players who already took it. */
    pickedUpBy: unknown;
    /** The legacy WorldItem, preserved verbatim — the wire/pickup boundary. */
    payload: unknown;
    spawnTime: number;
    expiresAt: number;
}

/**
 * A dropped world item. The `Expires` deadline replaces the per-item
 * setTimeout the drop code used to register; see systems/droppedItems.ts.
 */
export function spawnDroppedItem(world: World, spec: DroppedItemSpawn): Entity {
    const e = world.create();
    world.bindExternalId(e, spec.id);
    world.add(e, C.Position, { x: spec.x, y: spec.y });
    world.add(e, C.Radius, { value: 15 });
    world.add(e, C.DroppedItem, {
        petalType: spec.petalType,
        rarity: rarityToId(spec.rarity),
        kind: spec.kind,
        eligiblePlayers: spec.eligiblePlayers,
        pickedUpBy: spec.pickedUpBy,
        payload: spec.payload,
    });
    world.add(e, C.SpawnTime, { at: spec.spawnTime });
    world.add(e, C.Expires, { at: spec.expiresAt });
    world.add(e, C.IsDroppedItem);
    return e;
}

/** A static wall. Position is the top-left corner, matching the old Obstacle. */
export function spawnObstacle(
    world: World,
    spec: { x: number; y: number; width: number; height: number },
): Entity {
    const e = world.create();
    world.add(e, C.Position, { x: spec.x, y: spec.y });
    world.add(e, C.Box, { width: spec.width, height: spec.height });
    world.add(e, C.IsObstacle);
    return e;
}
