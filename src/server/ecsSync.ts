/**
 * The cutover: run mob and projectile simulation on the ECS while legacy code
 * keeps the rest.
 *
 * ---------------------------------------------------------------------------
 * What owns what
 * ---------------------------------------------------------------------------
 * This is a strangler step, not a big bang, and the ownership split is the
 * whole design:
 *
 *   ECS owns   mob CREATION (see server/enemyRegistry.ts), movement, AI,
 *              targeting, passive drift, centipede chains, mob-vs-mob
 *              collision, pet melee, projectile flight/collision/damage,
 *              PLAYER MOVEMENT INTEGRATION, PETAL RING KINEMATICS, the
 *              player-modifier derivation, mob DESPAWN and the REAPER (both
 *              through removal hooks), SLOWS end to end, mob POISON stacks,
 *              the player-poison loop, ground pollen and web fields, DROPPED
 *              ITEMS (see server/itemRegistry.ts), the spawner triggers
 *              (queen-ant escorts, ant-hole waves), and the broadcast's ENEMY
 *              wire encoding (ecs/net/enemyEncoder.ts, from component columns).
 *   LEGACY owns the player pipeline's interiors (contact, petal combat and
 *              the break/cooldown/reload machine, pickups' inventory half,
 *              teleporters, respawn) — scheduled under the ECS but reading
 *              ServerPlayer — plus damage attribution, the XP/drop/kill
 *              SEQUENCES the reap/kill hooks invoke, persistence, and the
 *              broadcast's player half. Mob CONFIG and the DATABASE FORMAT
 *              stay outside the ECS by design; the hooks are that boundary.
 *
 * "Petal ring kinematics" means the orbit-slot layout, the orbit point, the
 * spring/glide integrator and the per-instance state behind it (ecs/systems/
 * petalRing.ts, stored in the PetalRing component). It is stepped ONE INSTANCE
 * AT A TIME from the legacy petal loop rather than as a scheduled system,
 * because that loop interleaves kinematics with effects and instance k's
 * effects change instance k+1's kinematics. Note there is no petal SYNC below:
 * the ECS is the sole writer of petal kinematic state, so unlike mobs and
 * players there is no window and no field two sides can fight over. The one
 * value that crosses is the orbit phase, and it crosses one way — see
 * `openPetalRing`.
 *
 * "Player movement integration" is deliberately narrow: the ECS decides where a
 * flower's velocity carries it this tick and nothing else about the flower. See
 * `syncPlayersToEcs` for why that is a coherent ownership boundary even though
 * position is pushed IN as well as pulled OUT.
 *
 * Spawning moved in the same style projectiles did: mobs are BORN as entities,
 * so there is no per-tick import pass any more. What is left of the mob half of
import { damageMob, markMobDead, mobHealth, mobKnockbackX, mobKnockbackY, mobMaxHealth, mobTargetPlayerId } from './mobFields';
 * this file is (a) pushing in the handful of fields legacy still writes, and
 * (b) `maintainEnemyEntities`, which retires the entities of mobs that left —
 * removal itself is now one operation in server/enemyRegistry.ts that takes
 * both halves down together, so this is a drain plus a rare audit rather than
 * the per-tick reconcile it replaced.
 *
 * Projectiles are worth calling out: they are ECS entities end to end, and
 * nothing about them is mirrored back into a legacy array. That is why there is
 * no projectile handling in this file at all — a projectile never needs syncing
 * because legacy never writes one.
 *
 * Despawn is ECS-owned now: the viewport pass (systems/viewport.ts) keeps
 * ViewportTracked accurate, and both sweeps (mobExpiry, unseenDespawn) remove
 * through EcsRuntimeOptions.onMobDespawn, which splices the legacy shell,
 * runs cleanupEnemy and emits enemyDestroyed — the entity itself is retired
 * by the registry's deferred drain. Only the REAPER stays legacy: a combat
 * death awards XP and drops, and those stay with reapDeadEnemies.
 *
 * ---------------------------------------------------------------------------
 * The sync contract
 * ---------------------------------------------------------------------------
 * Per tick: legacy state is pushed IN, the ECS simulates, results are pushed
 * OUT onto the same legacy objects that petals, collision and the broadcast
 * already read. Nothing downstream needs to know the simulation moved.
 *
 * Fields are split by writer to avoid the two sides fighting:
 *   pushed IN  — health, knockback (legacy damage/effects write these)
 *   pushed OUT — x, y, angle, speed, isChasing, velX/velY (the ECS decides
 *                motion, and owns slows end to end)
 *
 * Pushing a field both ways would let one side's stale value overwrite the
 * other's fresh one, which is exactly how a dual-representation bug looks.
 */

import { ServerPlayer } from '../player';
import { Entity, World } from '../ecs';
import * as C from '../ecs/components';
import { mobTypes, rarityToId } from '../ecs/interning';
import { advanceOrbitPhase, PetalRingState } from '../ecs/systems/petalRing';
import { EcsRuntime } from './ecsRuntime';
import { importPlayer } from './ecsBridge';
import { drainRemovedEnemies } from './enemyRegistry';

/**
 * Systems legacy still owns, disabled so the two do not both act.
 *
 * EMPTY as of the 2026-08 conversion: every registered system is live. The
 * mechanism stays because it is the safety net the next cutover will want —
 * a name listed here that matches no scheduler is fatal at boot.
 *
 * `playerModifiers` was the last entry. It now derives speedBoost /
 * sizeMultiplier / magnetism / aggro from the Loadout component, the mirrored
 * effect list and the mirrored `speed_boost` base (see syncPlayersToEcs), with
 * the fold matched to shared/playerModifiers.ts (primary ten slots only,
 * legacy clamp semantics).
 */
const LEGACY_OWNED_SYSTEMS: string[] = [];

/**
 * Disable everything legacy still owns. Call once, after runtime creation.
 *
 * Every scheduler is searched and a name that matches NOTHING is fatal. The
 * systems are spread across four schedulers now (mob, player, projectile,
 * input), and `Scheduler.setEnabled` reports a miss with a return value nobody was reading —
 * so moving a system between schedulers, or renaming one, would silently leave
 * it enabled and have BOTH implementations run. That is the same silent-no-op
 * shape as the projectile-damage bug; make it crash at boot instead.
 */
export function configureCutover(runtime: EcsRuntime): void {
    const schedulers = [
        runtime.scheduler,
        runtime.playerScheduler,
        runtime.projectileScheduler,
        runtime.inputScheduler,
    ];
    for (const name of LEGACY_OWNED_SYSTEMS) {
        let found = 0;
        for (const scheduler of schedulers) {
            if (scheduler.setEnabled(name, false)) found++;
        }
        if (found === 0) {
            throw new Error(
                `[ECS] configureCutover: no system named "${name}" on any scheduler. `
                + 'It was renamed or removed; legacy and the ECS would both run it.',
            );
        }
    }
}

/** Entities the ECS created for legacy players, so removals can be detected. */
const seenPlayerIds = new Set<string>();

/**
 * Mob-entity reconcile state.
 *
 * Enemies no longer need a "seen" set: the WORLD is the record of what exists,
 * so the reconcile asks it directly rather than keeping a mirror that could
 * drift out of step with it. The query is cached per world; the scratch
 * containers are reused so a 1400-mob tick allocates nothing.
 *
 */

/**
 * Deferred structural changes from the push-in pass.
 *
 * `syncToEcs` iterates chunks, and adding or removing a component mid-iteration
 * would move the entity to another archetype and swap an unvisited row into a
 * slot the loop has already passed. So the pass RECORDS the toggles it wants
 * and applies them after iteration finishes. They only fire on a state CHANGE
 * (a slow landing or lapsing, a death), so these stay empty
 * on a quiet tick. Parallel arrays rather than objects: this is per-mob and
 * allocating a record per toggle is what the pass is trying to avoid.
 */

/** Warn once if a mob turns up without MobAI; see the provocation push below. */


/**
 * The entity for `player`, importing it if this is the first time it has been
 * seen.
 *
 * Exported because a player can act before syncToEcs has run for them: petal
 * firing happens in updatePlayerState, which runs BEFORE moveEnemies in the
 * simulation step, so on a player's very first tick their shots would otherwise
 * be stamped with a dead shooter and deal nothing. Going through here (rather
 * than importing directly) is also what keeps `seenPlayerIds` complete, so the
 * entity is still destroyed when the player leaves.
 */
export function ensurePlayerEntity(world: World, player: ServerPlayer, now: number): Entity {
    const existing = world.lookup(player.id);
    if (existing !== undefined) return existing;
    const entity = importPlayer(world, player, now);
    seenPlayerIds.add(player.id);
    return entity;
}

// ---------------------------------------------------------------------------
// The player movement window
// ---------------------------------------------------------------------------
// There is no PlayerSyncDeps any more: the derived modifiers (speedBoost,
// sizeMultiplier, magnetism, aggro) are computed by the ECS playerModifiers
// system from the Loadout, the mirrored effect list and the mirrored
// speed_boost base — the push below carries only the INPUTS legacy still
// writes, never a derived value.

/**
 * Push each player's transform, motion, input and modifiers INTO the ECS.
 *
 * This opens the movement window. It MUST be immediately followed by
 * `runtime.tickPlayers(...)` and then `syncPlayersFromEcs(...)`: the three form
 * one atomic operation, and any legacy write to x/y/angle/velocity that lands
 * between the push and the pull is discarded by the pull.
 *
 * ---------------------------------------------------------------------------
 * Why position is pushed IN here and pulled OUT below
 * ---------------------------------------------------------------------------
 * That looks exactly like the dual-representation bug this codebase keeps
 * hitting, so the rule is worth stating precisely. Ownership is scoped to the
 * window, not to the tick:
 *
 *   inside the window   the ECS owns x, y, angle, velocity and speedFactor
 *   outside the window  the legacy ServerPlayer owns them
 *
 * Outside the window legacy writes those fields from a dozen places that are
 * NOT ported and must not be — mob-contact knockback and the wall/teleporter/
 * maze/arena clamps in updatePlayerState, projectile knockback in
 * applyProjectileHitToPlayer, respawn, split halves, admin teleports. Pushing IN
 * at the top of the window is what makes all of those authoritative; pulling OUT
 * at the bottom is what makes the integration authoritative. Nothing is ever
 * read from one representation while the other is the fresher one.
 *
 * The mob window's `syncToEcs` also pushes player Position/Angle IN, and for the
 * same reason: by then updatePlayerState has run and moved the flower again, and
 * mobs must chase where it actually is.
 */
export function syncPlayersToEcs(
    world: World,
    players: Record<string, ServerPlayer>,
    now: number,
): void {
    for (const id in players) {
        const player = players[id];
        // `inputs` is declared non-optional on ServerPlayer but updatePlayerState
        // guards for it, and a player without it does not move at all there.
        // Reproduce that by leaving the entity out of the window entirely: the
        // pull below skips it too, so its legacy transform is untouched.
        if (!player || !player.inputs) continue;

        let entity = world.lookup(id);
        if (entity === undefined) entity = ensurePlayerEntity(world, player, now);

        // Seed the staging pair with the identity, so a flower that somehow
        // misses the pull below (no entity, an exception mid-window) resumes
        // from where it actually is rather than from a position left over from
        // an earlier tick. See ServerPlayer.movedX for what the pair is for.
        //
        // This sits ABOVE the dead-player skip on purpose, and that placement is
        // a bug fix rather than tidying. A corpse is never integrated, so its
        // pair used to freeze at whatever the integrator produced on the last
        // tick the player was ALIVE, while legacy carried on moving the corpse
        // (validatePlayerPositions recentres an out-of-bounds one, the death
        // knockback lands after the window, arena/maze exits teleport it). Then
        // a mid-tick revive — the yggdrasil petal sets `isDead = false` from
        // inside ANOTHER player's updatePlayerState — let the revived flower's
        // own updatePlayerState run in that same loop, seed `newX` from that
        // stale pair and commit it, teleporting the player back to where they
        // stood before they died. Keeping the pair pinned to the corpse's real
        // position makes a revive resume in place from any revive path, not just
        // the yggdrasil one.
        player.movedX = player.x;
        player.movedY = player.y;

        // A dead player must not be moved, and must be invisible to targeting.
        // Kept in step here as well as in syncToEcs because this pass runs first
        // and the movement query routes on the tag.
        const isDead = !!player.isDead;
        if (isDead && !world.has(entity, C.IsDead)) world.add(entity, C.IsDead);
        else if (!isDead && world.has(entity, C.IsDead)) world.remove(entity, C.IsDead);
        if (isDead) continue;

        world.write(entity, C.Position, { x: player.x, y: player.y });
        world.write(entity, C.Velocity, { x: player.velocityX, y: player.velocityY });
        world.set(entity, C.Angle, 'value', player.angle);

        // --- input ----------------------------------------------------------
        // Pushed EVERY TICK. It used to be written once, at import, which meant
        // that turning the movement system on would have made every flower move
        // forever on the inputs sampled during its first tick — and all four
        // gates would still have passed. Humans REPLACE `player.inputs` with a
        // fresh object off-tick (session.ts) while bots MUTATE the existing one
        // in place, so reading the fields here, at a fixed point in the tick,
        // is what makes both shapes behave identically.
        const inputs = player.inputs;
        // The legacy branch required all three mouse fields to be present before
        // it would trust `useMouse`, and fell through to the keyboard branch
        // otherwise. Resolve that here so the system can route on one flag.
        const useMouse = !!inputs.useMouse
            && inputs.mouseDirectionX !== undefined
            && inputs.mouseDirectionY !== undefined
            && inputs.mouseSpeedMultiplier !== undefined;
        world.write(entity, C.PlayerInput, {
            seq: inputs.seq ?? 0,
            lastProcessedSeq: player.lastProcessedInputSeq ?? 0,
            keys: inputs.keys ?? [],
            useMouse: useMouse ? 1 : 0,
            mouseDirectionX: inputs.mouseDirectionX ?? 0,
            mouseDirectionY: inputs.mouseDirectionY ?? 0,
            mouseSpeedMultiplier: inputs.mouseSpeedMultiplier ?? 1,
            petalExtension: inputs.petalExtension ?? 0,
        });

        // --- modifier INPUTS -------------------------------------------------
        // The playerModifiers system derives speedBoost/sizeMultiplier/
        // magnetism/aggro from the Loadout each tick (Phase.Input, before
        // movement reads them). What legacy still writes — the speed-boost
        // consumable's base multiplier and the active effect LIST — is
        // mirrored in here, exactly like Poisoned: legacy stays the writer of
        // WHAT is active, the ECS derives what it means.
        world.set(entity, C.PlayerModifiers, 'speedBoostBase', player.speed_boost || 1);
        const effects = player.effects;
        if (effects && effects.length > 0) {
            if (world.has(entity, C.PlayerEffects)) {
                world.set(entity, C.PlayerEffects, 'list', effects);
            } else {
                world.add(entity, C.PlayerEffects, { list: effects });
            }
        } else if (world.has(entity, C.PlayerEffects)) {
            world.remove(entity, C.PlayerEffects);
        }

        // The loadout is LEGACY-owned, so it is pushed in every tick like health
        // and speed — not captured once at import.
        //
        // This was missed, and bots showed no petals because of it. `C.Loadout`
        // holds a REFERENCE to the legacy array, and several legacy sites
        // REPLACE that array rather than mutating it — respawnBot assigns a
        // fresh `buildBotLoadout(...)`, and the loadout editors build new
        // arrays too. After any of those the component still pointed at the
        // array captured at importPlayer, so the ring laid out stale slots.
        // Bots die and respawn constantly, which is why it showed there first
        // and most obviously; a human hitting a loadout edit or a respawn had
        // the same stale reference.
        //
        // A pointer write per player per tick, and it makes the ownership rule
        // uniform: everything legacy still writes gets pushed IN.
        world.set(entity, C.Loadout, 'slots', player.loadout);
    }
}

/**
 * Pull the movement result back onto the legacy objects, closing the window.
 *
 * Six fields, and they are precisely the six the system wrote — but note WHERE
 * the position goes. Velocity, angle and speedFactor land directly on the
 * player, because the legacy code assigned all three up-front too. The POSITION
 * goes to the `movedX`/`movedY` staging pair instead, because the legacy code
 * kept it in locals until the very end of updatePlayerState and a great deal
 * depends on that: while those ~1700 lines run, `player.x`/`player.y` must still
 * be the PREVIOUS tick's committed position, which is what makes petals trail
 * the flower instead of orbiting its live centre. See ServerPlayer.movedX.
 *
 * `speedFactor` is written straight out because it is not an internal: the
 * broadcast sends it to the owning client so client-side prediction runs at the
 * server's speed, and a stale one desyncs prediction rather than failing.
 *
 * Dead players are skipped rather than round-tripped. Their components were not
 * touched by the pass, so writing back would be a no-op for the transform, but
 * it would stamp a stale `speedFactor` onto a flower the system did not visit.
 */
export function syncPlayersFromEcs(world: World, players: Record<string, ServerPlayer>): void {
    for (const id in players) {
        const player = players[id];
        if (!player || !player.inputs || player.isDead) continue;

        const entity = world.lookup(id);
        if (entity === undefined) continue;

        player.movedX = world.get(entity, C.Position, 'x') as number;
        player.movedY = world.get(entity, C.Position, 'y') as number;
        player.velocityX = world.get(entity, C.Velocity, 'x') as number;
        player.velocityY = world.get(entity, C.Velocity, 'y') as number;
        player.angle = world.get(entity, C.Angle, 'value') as number;
        player.speedFactor = world.get(entity, C.PlayerModifiers, 'speedFactor') as number;
    }
}

/**
 * Move a player from OUTSIDE their own `updatePlayerState`.
 *
 * `player.x/y` is not the whole of a flower's position during the player loop.
 * Between the movement window closing and a given flower's own
 * updatePlayerState committing, that flower's live position is the STAGING PAIR:
 * updatePlayerState opens with `let newX = player.movedX ?? player.x` and closes
 * ~1700 lines later with `player.x = newX`. A write to `player.x` made inside
 * that gap is overwritten by the commit and silently lost.
 *
 * Whether the gap is open depends on the iteration order over `players`, which
 * is insertion order and nothing a caller can reason about. PVP knockback is
 * written by the ATTACKER's update, so it landed for a victim that had already
 * been updated this tick and vanished for one that had not — the same flower
 * knocked back or not depending on who joined the server first. This is a
 * regression from the movement cutover: integration used to run INSIDE
 * updatePlayerState starting from `player.x`, so a knockback written by an
 * earlier player in the loop was picked up by the victim's own step.
 *
 * Applying the delta to BOTH representations restores that, in either order and
 * without ever applying it twice:
 *   - victim not yet updated: `newX` is seeded from the bumped `movedX`, and the
 *     commit writes that same displaced value back over the bumped `player.x`.
 *     Bumping `player.x` as well is not redundant — it is what the pre-cutover
 *     code did, and the victim's petal block reads `player.x` as the flower's
 *     previous position while it runs.
 *   - victim already updated: `player.x` is live and keeps the delta; the
 *     `movedX` bump is inert, because the next `syncPlayersToEcs` reseeds the
 *     pair from `player.x` before anything reads it.
 *
 * Callers that run after the whole player loop has finished (projectile
 * knockback in server.ts, respawn, admin teleports) may write `player.x/y`
 * directly since the gap is closed by then, but going through here is correct
 * for them too.
 */
export function displacePlayer(player: ServerPlayer, dx: number, dy: number): void {
    player.x += dx;
    player.y += dy;
    if (player.movedX !== undefined) player.movedX += dx;
    if (player.movedY !== undefined) player.movedY += dy;
}

// ---------------------------------------------------------------------------
// The petal ring
// ---------------------------------------------------------------------------
/**
 * What a flower's petal ring needs, resolved for one tick.
 *
 * Note what is NOT here: there is no petal push-in and no petal pull-out. That
 * is deliberate and it is the safest possible shape for this boundary. The ECS
 * is the SOLE owner of petal kinematic state — nothing legacy writes a petal's
 * position, velocity or spring state — so there is no window to get wrong and
 * no field that two writers can fight over. Compare the mob and player halves of
 * this file, which exist only because legacy still writes health, speed,
 * knockback and transforms.
 *
 * The one value that does cross is the orbit phase, and it crosses ONE WAY
 * (out): see `openPetalRing`.
 */
export interface OpenPetalRing {
    /** The ECS-owned per-instance spring/glide store for this flower. */
    state: PetalRingState;
    /** The orbit phase AFTER this tick's integration. */
    orbitPhase: number;
}

/**
 * Open a flower's petal ring for this tick.
 *
 * Call once per player per tick, at the point in `updatePlayerState` where the
 * legacy code integrated `player.petalOrbitPhase` — i.e. AFTER the ring layout
 * is known (it stores the slot count) and BEFORE any instance is stepped.
 *
 * ---------------------------------------------------------------------------
 * Why `player.petalOrbitPhase` is still written
 * ---------------------------------------------------------------------------
 * The ECS owns the phase; the legacy field is a MIRROR, written out and never
 * read back by the simulation. It is kept because two legacy paths still consume
 * it and both would otherwise silently reset a flower's orbit:
 *
 *   - `ecsBridge.importPlayer` seeds the component from it, which is what makes
 *     an entity rebuilt for an existing player resume its orbit in place;
 *   - `petal_actions.splitPlayer` clones the ServerPlayer wholesale, so the
 *     splitter half inherits the phase and the two halves' rings stay in step
 *     instead of the clone snapping to angle 0.
 *
 * It is written OUT only, exactly like `speedFactor` in `syncPlayersFromEcs`.
 * Nothing in the tick reads it, so there is no direction for a stale value to
 * flow back in.
 */
export function openPetalRing(
    world: World,
    player: ServerPlayer,
    now: number,
    slotCount: number,
    rotationSpeedModifier: number,
    deltaTime: number,
): OpenPetalRing {
    const entity = ensurePlayerEntity(world, player, now);

    // `spawnPlayer` gives every flower a PetalRing at birth, so this is a
    // backstop for an entity that reached here some other way rather than the
    // normal path. Adding it here would be an archetype move mid-player-loop —
    // safe (no query is iterating), but it should never happen.
    if (!world.has(entity, C.PetalRing)) {
        world.add(entity, C.PetalRing, { state: new PetalRingState(), slotCount: 0 });
    }
    world.set(entity, C.PetalRing, 'slotCount', slotCount);

    const orbitPhase = advanceOrbitPhase(
        world.get(entity, C.PlayerModifiers, 'petalOrbitPhase') as number,
        rotationSpeedModifier,
        deltaTime,
    );
    world.set(entity, C.PlayerModifiers, 'petalOrbitPhase', orbitPhase);
    player.petalOrbitPhase = orbitPhase;

    return {
        state: world.get(entity, C.PetalRing, 'state') as PetalRingState,
        orbitPhase,
    };
}

/**
 * Keep the two representations honest, cheaply.
 *
 * There used to be a full RECONCILE here: a set of every live shell, a sweep of
 * every mob entity, and a destroy for any entity whose shell had gone. It was
 * O(all mobs) every tick to find the handful of removals a tick actually has,
 * and it existed because removal was scattered across a dozen legacy splices
 * that knew nothing about the ECS.
 *
 * Removal is now a single operation that retires both halves together
 * (`removeEnemy`/`removeEnemyAt` in server/enemyRegistry.ts), and the shell
 * array itself is a VIEW projected out of the world (`liveEnemies()`), not a
 * container. A shell therefore cannot exist without an entity and an entity
 * cannot linger without a shell: the two are the same fact read two ways, so
 * there is nothing left for a sweep or an audit to discover.
 *
 * What remains is `drainRemovedEnemies`, which retires the entities queued by
 * those removals — the deferral is what keeps a kill arriving from inside the
 * projectile or mob-collision sweep from pulling a row out from under it.
 *
 * (The periodic audit and the orphan-adoption path that used to live here are
 * gone with the container. They existed to repair disagreement between two
 * hand-maintained representations; with one representation there is no
 * disagreement to repair.)
 */
function maintainEnemyEntities(world: World): void {
    drainRemovedEnemies(world);
}

/**
 * Push legacy state into the ECS.
 *
 * Mobs arrive already built (server/enemyRegistry.ts), so there is no import
 * pass: this copies in the mutable fields LEGACY still writes — health from
 * petal damage, speed from slows, knockback from impacts — so the ECS simulates
 * against current values.
 */
export function syncToEcs(
    world: World,
    players: Record<string, ServerPlayer>,
    now: number,
): void {
    // --- players ---------------------------------------------------------
    const livePlayerIds = new Set<string>();
    for (const id in players) {
        const player = players[id];
        if (!player) continue;
        livePlayerIds.add(id);

        const entity = world.lookup(id);
        if (entity === undefined) {
            ensurePlayerEntity(world, player, now);
            continue;
        }
        // The movement window closed long before this runs (it is at the top of
        // runSimulationStep; this is inside moveEnemies), and updatePlayerState
        // has since applied knockback, wall clamps, teleports and respawns. So
        // the transform is pushed IN again here, and mobs chase where the flower
        // actually ended the tick rather than where the integrator left it.
        world.write(entity, C.Position, { x: player.x, y: player.y });
        world.set(entity, C.Angle, 'value', player.angle);
        world.write(entity, C.Health, { current: player.health, max: player.maxHealth });
        // aggroRadiusBonus is no longer pushed here: the playerModifiers
        // system derives it from the Loadout during the player tick, which
        // runs earlier in this same simulation step.
        // A dead player must be invisible to targeting immediately.
        const isDead = !!player.isDead;
        if (isDead && !world.has(entity, C.IsDead)) world.add(entity, C.IsDead);
        else if (!isDead && world.has(entity, C.IsDead)) world.remove(entity, C.IsDead);

        // Poison mirrors the shell: legacy is still the authority for WHO is
        // poisoned (the bite site and respawn both write ServerPlayer fields),
        // while the ECS playerPoison system runs the per-tick effect. This runs
        // AFTER the player pipeline within the tick, so a bite lands on the
        // component before the poison system ticks — no one-tick lag.
        const poisoned = !isDead
            && player.poisonUntil !== undefined && player.poisonDamage !== undefined;
        if (poisoned) {
            if (world.has(entity, C.Poisoned)) {
                world.write(entity, C.Poisoned, {
                    damagePerSecond: player.poisonDamage,
                    until: player.poisonUntil,
                });
            } else {
                world.add(entity, C.Poisoned, {
                    damagePerSecond: player.poisonDamage!,
                    until: player.poisonUntil!,
                    sourceType: player.poisonSource ? mobTypes.intern(player.poisonSource.type) : 0,
                    sourceTier: player.poisonSource ? rarityToId(player.poisonSource.tier) : 0,
                });
            }
        } else if (world.has(entity, C.Poisoned)) {
            world.remove(entity, C.Poisoned);
        }
        if (isDead && player.poisonUntil !== undefined) {
            // Legacy cleared the fields the tick a poisoned flower died.
            player.poisonUntil = undefined;
            player.poisonDamage = undefined;
            player.poisonSource = undefined;
        }
    }

    for (const id of seenPlayerIds) {
        if (livePlayerIds.has(id)) continue;
        const entity = world.lookup(id);
        if (entity !== undefined) world.destroy(entity);
        seenPlayerIds.delete(id);
    }

    // --- enemies ---------------------------------------------------------
    // Nothing is pushed IN for mobs any more.
    //
    // This used to copy health, maxHealth, knockback, death and provocation off
    // the shell and onto the components, once per mob per tick, because legacy
    // damage handlers wrote the shell and the simulation read the components.
    // Legacy now writes the components directly (server/mobFields.ts), so there
    // is one writer and nothing to reconcile — the copy would be a no-op.
    maintainEnemyEntities(world);
}

/**
 * The write-back pass is gone.
 *
 * `syncFromEcs` copied position, facing, speed, knockback, health, death and
 * targeting out of the components and onto the shell every tick, so that legacy
 * readers saw current values. Those fields no longer exist on the shell —
 * legacy reads them straight from the components through server/mobFields.ts —
 * so there is nothing left to write back. The MIN-merge that used to reconcile
 * ECS damage with legacy damage went with it: there is one writer now.
 */

/** Reset cross-tick tracking. For tests and for a clean world rebuild. */
export function resetSyncState(): void {
    seenPlayerIds.clear();
}
