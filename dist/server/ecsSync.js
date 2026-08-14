"use strict";
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
 *              PLAYER MOVEMENT INTEGRATION, and PETAL RING KINEMATICS.
 *   LEGACY owns despawning, everything else about players (collision, pickups,
 *              teleporters, respawn), the rest of petals — per-instance health,
 *              the break/cooldown/reload machine, combat, fields and auras, the
 *              action VM — damage attribution, drops, XP, persistence and the
 *              broadcast.
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
 * this file is (a) pushing in the handful of fields legacy still writes, and
 * (b) `reconcileEnemyEntities`, the removal half — because ~14 legacy sites
 * still splice `enemies[]` and lifecycle is not ported yet.
 *
 * Projectiles are worth calling out: they are ECS entities end to end, and
 * nothing about them is mirrored back into a legacy array. That is why there is
 * no projectile handling in this file at all — a projectile never needs syncing
 * because legacy never writes one.
 *
 * Despawn deliberately stays with legacy. The viewport-status pass IS ported
 * (systems/viewport.ts), so ViewportTracked is accurate; what still blocks the
 * ECS despawn/reaper is the REMOVAL side. Destroying the entity would leave the
 * mob in legacy `enemies[]` forever and clients would never receive
 * enemyDestroyed, so moving it needs a despawn hook that splices the array and
 * emits — the same shape as the creditDamage/onEnemyDamaged hooks.
 *
 * ---------------------------------------------------------------------------
 * The sync contract
 * ---------------------------------------------------------------------------
 * Per tick: legacy state is pushed IN, the ECS simulates, results are pushed
 * OUT onto the same legacy objects that petals, collision and the broadcast
 * already read. Nothing downstream needs to know the simulation moved.
 *
 * Fields are split by writer to avoid the two sides fighting:
 *   pushed IN  — health, speed, knockback (legacy damage/effects write these)
 *   pushed OUT — x, y, angle, isChasing, velX/velY (the ECS decides motion)
 *
 * Pushing a field both ways would let one side's stale value overwrite the
 * other's fresh one, which is exactly how a dual-representation bug looks.
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
exports.configureCutover = configureCutover;
exports.orphanAdoptionCount = orphanAdoptionCount;
exports.ensurePlayerEntity = ensurePlayerEntity;
exports.syncPlayersToEcs = syncPlayersToEcs;
exports.syncPlayersFromEcs = syncPlayersFromEcs;
exports.displacePlayer = displacePlayer;
exports.openPetalRing = openPetalRing;
exports.syncToEcs = syncToEcs;
exports.syncFromEcs = syncFromEcs;
exports.resetSyncState = resetSyncState;
const C = __importStar(require("../ecs/components"));
const petalRing_1 = require("../ecs/systems/petalRing");
const ecsBridge_1 = require("./ecsBridge");
/** Systems legacy still owns, disabled so the two do not both act. */
const LEGACY_OWNED_SYSTEMS = [
    // `playerMovement` is NOT here any more — the ECS owns it. See
    // syncPlayersToEcs/syncPlayersFromEcs below for the window it runs in.
    //
    // `playerModifiers` still is. It derives speedBoost/sizeMultiplier from the
    // Loadout and PlayerEffects COMPONENTS, and two things are wrong with that
    // today: it does not include `player.speed_boost` (the base multiplier the
    // legacy formula starts from), and the legacy skill/effect pipeline is still
    // the writer of the effect list. So the values are pushed IN from
    // `getSpeedMultiplier` instead, which keeps ECS movement bit-identical to
    // the code it replaced. Enabling this system is the NEXT step, and it must
    // be done together with removing those fields from the push.
    'playerModifiers',
    'expiry', // legacy timers
    // The viewport pass IS ported now (systems/viewport.ts), so ViewportTracked
    // is accurate. What still blocks this is the removal side: the ECS reaper
    // destroys the entity, but legacy enemies[] would keep the mob forever and
    // clients would never get enemyDestroyed. Moving it needs a despawn hook
    // that splices the legacy array and emits.
    'unseenDespawn',
    'reaper', // legacy reapDeadEnemies awards XP and drops
    'poisonStacks', // legacy updatePoisonEffects
    'playerPoison', // legacy updatePlayerPoison
    'slowExpiry', // legacy updateSlowEffects
];
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
function configureCutover(runtime) {
    const schedulers = [
        runtime.scheduler,
        runtime.playerScheduler,
        runtime.projectileScheduler,
        runtime.inputScheduler,
    ];
    for (const name of LEGACY_OWNED_SYSTEMS) {
        let found = 0;
        for (const scheduler of schedulers) {
            if (scheduler.setEnabled(name, false))
                found++;
        }
        if (found === 0) {
            throw new Error(`[ECS] configureCutover: no system named "${name}" on any scheduler. `
                + 'It was renamed or removed; legacy and the ECS would both run it.');
        }
    }
}
/** Entities the ECS created for legacy players, so removals can be detected. */
const seenPlayerIds = new Set();
/**
 * Mob-entity reconcile state.
 *
 * Enemies no longer need a "seen" set: the WORLD is the record of what exists,
 * so the reconcile asks it directly rather than keeping a mirror that could
 * drift out of step with it. The query is cached per world; the scratch
 * containers are reused so a 1400-mob tick allocates nothing.
 */
let enemyEntityQuery;
let enemyEntityQueryWorld;
const liveEnemyIds = new Set();
const orphanEntities = [];
/**
 * Mobs adopted because they turned up in `enemies[]` with no entity.
 *
 * Should stay at zero forever: `spawnEnemy` creates the entity before the push
 * and `LiveEnemy` makes that the only way in. It is counted and logged rather
 * than silently handled because an orphan means some path found a way around
 * the registry — the failure this whole design exists to prevent, and one that
 * would otherwise present as "a few mobs are statues".
 */
let orphanAdoptions = 0;
/** How many shells have been adopted for want of an entity. Should be 0. */
function orphanAdoptionCount() {
    return orphanAdoptions;
}
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
function ensurePlayerEntity(world, player, now) {
    const existing = world.lookup(player.id);
    if (existing !== undefined)
        return existing;
    const entity = (0, ecsBridge_1.importPlayer)(world, player, now);
    seenPlayerIds.add(player.id);
    return entity;
}
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
function syncPlayersToEcs(world, players, now, deps) {
    for (const id in players) {
        const player = players[id];
        // `inputs` is declared non-optional on ServerPlayer but updatePlayerState
        // guards for it, and a player without it does not move at all there.
        // Reproduce that by leaving the entity out of the window entirely: the
        // pull below skips it too, so its legacy transform is untouched.
        if (!player || !player.inputs)
            continue;
        let entity = world.lookup(id);
        if (entity === undefined)
            entity = ensurePlayerEntity(world, player, now);
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
        if (isDead && !world.has(entity, C.IsDead))
            world.add(entity, C.IsDead);
        else if (!isDead && world.has(entity, C.IsDead))
            world.remove(entity, C.IsDead);
        if (isDead)
            continue;
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
        // --- derived modifiers ----------------------------------------------
        // The `playerModifiers` SYSTEM is disabled (see LEGACY_OWNED_SYSTEMS):
        // it does not fold in `player.speed_boost` and the effect pipeline that
        // feeds it is still legacy. Pushing the legacy values keeps movement
        // arithmetically identical to `computeTargetVelocity`. The 8x clamp and
        // the NaN guard stay in the system, exactly where they were.
        world.set(entity, C.PlayerModifiers, 'speedBoost', deps.speedBoostOf(player));
        world.set(entity, C.PlayerModifiers, 'sizeMultiplier', player.sizeMultiplier ?? 1.0);
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
function syncPlayersFromEcs(world, players) {
    for (const id in players) {
        const player = players[id];
        if (!player || !player.inputs || player.isDead)
            continue;
        const entity = world.lookup(id);
        if (entity === undefined)
            continue;
        player.movedX = world.get(entity, C.Position, 'x');
        player.movedY = world.get(entity, C.Position, 'y');
        player.velocityX = world.get(entity, C.Velocity, 'x');
        player.velocityY = world.get(entity, C.Velocity, 'y');
        player.angle = world.get(entity, C.Angle, 'value');
        player.speedFactor = world.get(entity, C.PlayerModifiers, 'speedFactor');
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
function displacePlayer(player, dx, dy) {
    player.x += dx;
    player.y += dy;
    if (player.movedX !== undefined)
        player.movedX += dx;
    if (player.movedY !== undefined)
        player.movedY += dy;
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
function openPetalRing(world, player, now, slotCount, rotationSpeedModifier, deltaTime) {
    const entity = ensurePlayerEntity(world, player, now);
    // `spawnPlayer` gives every flower a PetalRing at birth, so this is a
    // backstop for an entity that reached here some other way rather than the
    // normal path. Adding it here would be an archetype move mid-player-loop —
    // safe (no query is iterating), but it should never happen.
    if (!world.has(entity, C.PetalRing)) {
        world.add(entity, C.PetalRing, { state: new petalRing_1.PetalRingState(), slotCount: 0 });
    }
    world.set(entity, C.PetalRing, 'slotCount', slotCount);
    const orbitPhase = (0, petalRing_1.advanceOrbitPhase)(world.get(entity, C.PlayerModifiers, 'petalOrbitPhase'), rotationSpeedModifier, deltaTime);
    world.set(entity, C.PlayerModifiers, 'petalOrbitPhase', orbitPhase);
    player.petalOrbitPhase = orbitPhase;
    return {
        state: world.get(entity, C.PetalRing, 'state'),
        orbitPhase,
    };
}
/**
 * Adopt a legacy shell that has no entity.
 *
 * The safety net for the removal-half asymmetry: creation is structural, but if
 * anything ever does launder an `Enemy` into `enemies[]` (by widening the array
 * to `Enemy[]` across a function boundary, say), the mob would otherwise sit
 * there un-simulated and nothing would fail. Adopting keeps the game correct;
 * the log is what makes the bug findable.
 */
function adoptOrphanShell(world, enemy, now) {
    const entity = (0, ecsBridge_1.importEnemy)(world, enemy, now);
    (0, ecsBridge_1.linkEnemyReferences)(world, enemy);
    orphanAdoptions++;
    if (orphanAdoptions === 1 || orphanAdoptions % 100 === 0) {
        console.warn(`[ECS] adopted a mob with no entity (${enemy.type} ${enemy.tier} ${enemy.id}); `
            + `${orphanAdoptions} so far. Something bypassed spawnEnemy() — see server/enemyRegistry.ts.`);
    }
    return entity;
}
/**
 * Destroy mob entities whose legacy shell has left `enemies[]`.
 *
 * The removal half of the bridge. Legacy still owns despawn and splices the
 * array from a dozen places (the reaper, killHandler, pet despawns, the maze
 * rotation, the distance despawner); rather than teach every one of them about
 * the ECS, the world is reconciled against the array once per tick. An entity
 * that outlived its shell would keep moving, keep shooting and keep taking up
 * grid space while being invisible to every client.
 *
 * Runs BEFORE the field push-in so a departed mob is not simulated for the tick
 * it left on.
 */
function reconcileEnemyEntities(world, enemies) {
    if (enemyEntityQuery === undefined || enemyEntityQueryWorld !== world) {
        enemyEntityQuery = world.query([C.IsEnemy]);
        enemyEntityQueryWorld = world;
    }
    liveEnemyIds.clear();
    for (let i = 0; i < enemies.length; i++)
        liveEnemyIds.add(enemies[i].id);
    // Collected first: destroying during iteration would swap an unvisited row
    // into the slot the loop just passed.
    orphanEntities.length = 0;
    enemyEntityQuery.chunks(chunk => {
        const entities = chunk.entities;
        for (let i = 0; i < chunk.count; i++) {
            const entity = entities[i];
            const id = world.externalIdOf(entity);
            // An unbound mob entity cannot currently exist (spawnMob always
            // binds one), and destroying it on a guess would eat any future
            // entity-only mob, so leave it be.
            if (id === undefined)
                continue;
            if (!liveEnemyIds.has(id))
                orphanEntities.push(entity);
        }
    });
    for (let i = 0; i < orphanEntities.length; i++)
        world.destroy(orphanEntities[i]);
    orphanEntities.length = 0;
}
/**
 * Push legacy state into the ECS.
 *
 * Mobs arrive already built (server/enemyRegistry.ts), so there is no import
 * pass: this copies in the mutable fields LEGACY still writes — health from
 * petal damage, speed from slows, knockback from impacts — so the ECS simulates
 * against current values.
 */
function syncToEcs(world, enemies, players, now) {
    // --- players ---------------------------------------------------------
    const livePlayerIds = new Set();
    for (const id in players) {
        const player = players[id];
        if (!player)
            continue;
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
        // Mob aggro reads this; it is derived by legacy petal code for now.
        if (world.has(entity, C.PlayerModifiers)) {
            world.set(entity, C.PlayerModifiers, 'aggroRadiusBonus', player.aggroRadiusBonus ?? 0);
        }
        // A dead player must be invisible to targeting immediately.
        const isDead = !!player.isDead;
        if (isDead && !world.has(entity, C.IsDead))
            world.add(entity, C.IsDead);
        else if (!isDead && world.has(entity, C.IsDead))
            world.remove(entity, C.IsDead);
    }
    for (const id of seenPlayerIds) {
        if (livePlayerIds.has(id))
            continue;
        const entity = world.lookup(id);
        if (entity !== undefined)
            world.destroy(entity);
        seenPlayerIds.delete(id);
    }
    // --- enemies ---------------------------------------------------------
    reconcileEnemyEntities(world, enemies);
    for (let i = 0; i < enemies.length; i++) {
        const enemy = enemies[i];
        const entity = world.lookup(enemy.id) ?? adoptOrphanShell(world, enemy, now);
        // Fields LEGACY writes.
        world.write(entity, C.Health, { current: enemy.health, max: enemy.maxHealth });
        world.write(entity, C.Speed, {
            current: enemy.speed,
            base: enemy.baseSpeed ?? enemy.speed,
        });
        // A slow applied by legacy shows up as speed below base.
        const slowed = enemy.slowUntil !== undefined && enemy.slowUntil > now;
        if (slowed && !world.has(entity, C.Slowed)) {
            world.add(entity, C.Slowed, { until: enemy.slowUntil });
        }
        else if (!slowed && world.has(entity, C.Slowed)) {
            world.remove(entity, C.Slowed);
        }
        if (enemy.knockbackX || enemy.knockbackY) {
            if (!world.has(entity, C.Knockback)) {
                world.add(entity, C.Knockback, { x: 0, y: 0 });
            }
            world.write(entity, C.Knockback, {
                x: enemy.knockbackX ?? 0,
                y: enemy.knockbackY ?? 0,
            });
        }
        // Legacy marks kills; the ECS must stop simulating them at once.
        const isDead = !!enemy.isDead || enemy.health <= 0;
        if (isDead && !world.has(entity, C.IsDead))
            world.add(entity, C.IsDead);
        // Provocation: legacy damage handlers set targetPlayerId directly, and
        // that is how a neutral mob becomes hostile.
        if (enemy.targetPlayerId) {
            const target = world.lookup(enemy.targetPlayerId);
            if (target !== undefined)
                world.set(entity, C.MobAI, 'targetPlayer', target);
        }
    }
}
/**
 * Push ECS results back onto the legacy objects.
 *
 * Only the fields the ECS decided: transform, motion and chase state. Health is
 * NOT written back here — legacy owns damage bookkeeping, and clobbering it
 * would drop damage applied later in the same tick. The one exception is pet
 * melee, which the ECS now performs, so its damage is merged rather than
 * overwritten.
 */
function syncFromEcs(world, enemies) {
    for (let i = 0; i < enemies.length; i++) {
        const enemy = enemies[i];
        const entity = world.lookup(enemy.id);
        if (entity === undefined)
            continue;
        enemy.x = world.get(entity, C.Position, 'x');
        enemy.y = world.get(entity, C.Position, 'y');
        enemy.angle = world.get(entity, C.Angle, 'value');
        if (world.has(entity, C.Velocity)) {
            enemy.velX = world.get(entity, C.Velocity, 'x');
            enemy.velY = world.get(entity, C.Velocity, 'y');
        }
        if (world.has(entity, C.MobAI)) {
            enemy.isChasing = !!world.get(entity, C.MobAI, 'isChasing');
        }
        if (world.has(entity, C.Knockback)) {
            enemy.knockbackX = world.get(entity, C.Knockback, 'x');
            enemy.knockbackY = world.get(entity, C.Knockback, 'y');
        }
        // Pet melee is simulated by the ECS, so damage it dealt has to come
        // back. Taking the MINIMUM merges it with any legacy damage applied
        // this tick instead of overwriting one with the other.
        const ecsHealth = world.get(entity, C.Health, 'current');
        if (ecsHealth < enemy.health)
            enemy.health = ecsHealth;
        if (world.has(entity, C.IsDead) && enemy.health > 0) {
            // The ECS killed it (pet melee); let legacy's reaper award the drop.
            enemy.health = 0;
        }
        // Targeting must round-trip. Legacy code still reads targetPlayerId —
        // trackDamage gates provocation on it (`!enemy.targetPlayerId`), a
        // splitting centipede copies it to its children, and item drops use it
        // for eligibility. Writing only INTO the ECS left those readers looking
        // at a field the simulation no longer maintained, so a mob the ECS had
        // acquired or dropped looked un-aggroed to every legacy consumer.
        if (world.has(entity, C.MobAI)) {
            const target = world.get(entity, C.MobAI, 'targetPlayer');
            if (world.isAlive(target)) {
                enemy.targetPlayerId = world.externalIdOf(target);
            }
            else if (enemy.targetPlayerId !== undefined) {
                // Only clear once the ECS has genuinely dropped it, so a
                // provocation applied by legacy later this tick survives.
                enemy.targetPlayerId = undefined;
            }
            const targetEnemy = world.get(entity, C.MobAI, 'targetEnemy');
            enemy.targetEnemyId = world.isAlive(targetEnemy)
                ? world.externalIdOf(targetEnemy) : undefined;
            const targetPet = world.get(entity, C.MobAI, 'targetPet');
            enemy.targetPetId = world.isAlive(targetPet)
                ? world.externalIdOf(targetPet) : undefined;
        }
        // Centipede chain links can be re-headed by the repair pass.
        if (world.has(entity, C.CentipedeSegment)) {
            const leader = world.get(entity, C.CentipedeSegment, 'leader');
            const head = world.get(entity, C.CentipedeSegment, 'head');
            enemy.leaderId = world.isAlive(leader) ? world.externalIdOf(leader) : undefined;
            enemy.headId = world.isAlive(head) ? world.externalIdOf(head) : undefined;
            enemy.segmentIndex = world.get(entity, C.CentipedeSegment, 'segmentIndex');
        }
    }
}
/** Reset cross-tick tracking. For tests and for a clean world rebuild. */
function resetSyncState() {
    seenPlayerIds.clear();
    enemyEntityQuery = undefined;
    enemyEntityQueryWorld = undefined;
    liveEnemyIds.clear();
    orphanEntities.length = 0;
    orphanAdoptions = 0;
}
