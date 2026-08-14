"use strict";
/**
 * The petal ring: orbit layout and kinematics.
 *
 * ===========================================================================
 * THE MODELLING DECISION: petal instances are NOT entities
 * ===========================================================================
 * The idiomatic ECS answer is one entity per petal instance, with a reference
 * back to the owning flower. That answer is wrong for THIS code, and the reason
 * is not taste — four concrete access patterns rule it out.
 *
 * 1. LIFETIME IS DERIVED, NOT EVENTED.
 *    Nothing ever "spawns a petal". The authoritative record of which instances
 *    exist is `player.loadout`, a legacy-owned array that a dozen sites REPLACE
 *    wholesale: equipping, the cooldown restore (which builds a brand-new Item
 *    object), PVP arena enter/exit, the maze rarity shift, splitter cloning,
 *    cross-server transfer, respawn. The instance list is recomputed from that
 *    array every tick by `layoutPetalRing` below. Entities would need a
 *    reconcile pass — the `reconcileEnemyEntities` shape — running for every
 *    player every tick over up to ~70 instances, with an archetype move (a full
 *    row copy plus a swap-remove) every time anyone touches their loadout.
 *    That is real per-tick churn bought to reproduce a keyed lookup.
 *
 * 2. HEALTH IS PER-SLOT, NOT PER-INSTANCE, FOR ALMOST EVERY PETAL.
 *    `getInstanceHealth`/`setInstanceHealth` fall through to `petal.health` —
 *    one shared number — unless the petal is `clumped` or `independentHealth`.
 *    A 5-count rose is five instances sharing one health pool and one cooldown;
 *    damage to any of them breaks all five. An entity-per-instance would either
 *    have no Health of its own (so the component that supposedly justifies the
 *    entity lives elsewhere) or hold a COPY of the slot's health — which is
 *    exactly the dual-representation shape that made mobs unkillable on the
 *    projectile cutover. The per-instance arrays that DO exist
 *    (`instanceHealth`, `instanceOnCooldown`, `instanceCooldownEndTime`) live
 *    on the loadout Item because the Item is persisted to the database and
 *    serialised across the cross-server portal; an entity cannot own state that
 *    has to survive leaving the process.
 *
 * 3. NOTHING QUERIES PETALS EXCEPT BY OWNER, IN SLOT ORDER.
 *    No spatial index contains petals — every petal-vs-X test is petal-driven
 *    (the petal queries the mob grid, the projectile bridge, the player map).
 *    No system iterates petals globally. Every single access is "for this
 *    flower, walk its instances in loadout order". Archetype iteration buys
 *    dense chunked iteration that has no consumer here, and its order is
 *    swap-remove order — neither stable nor owner-grouped.
 *
 * 4. THE BROADCAST NEEDS A DENSE PER-PLAYER ARRAY IN RING ORDER.
 *    `player.petalPositions` feeds a change-detection signature in
 *    tickBroadcast, so its ORDER and LENGTH are load-bearing. Rebuilding it
 *    bit-identically means walking the loadout in slot order — i.e. the
 *    derivation — not gathering scattered entities and sorting them back.
 *
 * So the flower is the entity and the ring is component data on it: `PetalRing`
 * (see components/petal.ts) carries a `PetalRingState`, and the orbit phase
 * lives in the `PlayerModifiers` column it always belonged in. The ECS owns the
 * KINEMATIC state (where each instance physically is, and how it got there);
 * the loadout Item keeps the state that has to outlive the process.
 *
 * Why the store is a Map of small structs rather than struct-of-arrays: the set
 * is at most ~70 entries per flower, it is never iterated densely (only point
 * looked-up by (loadoutIndex, instanceIndex)), and its indexing must stay
 * STABLE across loadout edits — equipping into slot 3 must not shift slot 5's
 * physics onto a different petal, which is precisely what a dense ring-ordered
 * layout would do. SoA's win is dense iteration; there is none to win here.
 *
 * ---------------------------------------------------------------------------
 * Two invariants this file exists to protect
 * ---------------------------------------------------------------------------
 * PREVIOUS-TICK PHASING. Every orbit position is measured from the flower's
 * PREVIOUS committed position, not its live one. That is why the geometry takes
 * `playerX`/`playerY` as explicit numbers instead of reading a Position column:
 * inside `updatePlayerState` the ECS-integrated position is parked in the
 * `movedX`/`movedY` staging pair and `player.x`/`player.y` still hold last
 * tick's commit, which is what makes petals trail the flower instead of
 * orbiting its live centre. Handing this module the entity would let it read
 * the wrong one.
 *
 * BIT-IDENTICAL POSITIONS. `petalPositions` is hashed for broadcast change
 * detection, so float drift here costs per-tick bandwidth forever. Every
 * expression below is a transcription of the code it replaced, in the same
 * association order, including the parts that look redundant (the `% (PI*2)` on
 * an angle that is about to go through cos/sin, the `* 2` that undoes a
 * historical 0.002 rad/ms rate, the separate `defendOnly` base radius). Do not
 * simplify them. `ecs/bench/petal_cutover_check.ts` asserts exact equality
 * against a verbatim copy of the legacy code and will fail on any algebraic
 * "cleanup".
 *
 * ---------------------------------------------------------------------------
 * What is NOT here, and why
 * ---------------------------------------------------------------------------
 * Petal COMBAT (mob damage, poison, slow, knockback, projectile blocking, PVP,
 * the flower/bubble/yggdrasil specials), the break/cooldown/reload state
 * machine, the fields and auras, and the petal action VM all stay in
 * playerState.ts / petal_actions.ts. The reason is ordering, not effort: the
 * legacy loop INTERLEAVES kinematics and effects per instance, and instance k's
 * effects change instance k+1's kinematics — a kill removes an attraction
 * target, and (for a shared-health slot) damage to instance 0 makes instance 1
 * take the break path and emit no position at all. Batching all the kinematics
 * first would therefore change both the VALUES and the LENGTH of
 * `petalPositions`. So this module is stepped per instance, in the legacy
 * order, by the legacy loop — the same shape as `stepPlayerMovement`, which is
 * shared verbatim rather than reimplemented.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PetalRingState = exports.PRIMARY_LOADOUT_SLOTS = exports.PETAL_SPAWN_SMOOTH_TIME = exports.PETAL_DAMPING = exports.PETAL_SPRING_FORCE = exports.PETAL_GLIDE_RATE = exports.PETAL_RELEASE_GLIDE_MS = exports.PETAL_SPAWN_GLIDE_MS = void 0;
exports.petalInstanceKey = petalInstanceKey;
exports.layoutPetalRing = layoutPetalRing;
exports.computeRingGeometry = computeRingGeometry;
exports.advanceOrbitPhase = advanceOrbitPhase;
exports.petalOrbitTarget = petalOrbitTarget;
exports.stepPetalKinematics = stepPetalKinematics;
// ---------------------------------------------------------------------------
// Tunables, moved verbatim from server/playerState.ts
// ---------------------------------------------------------------------------
/** Reload/spawn: fly-out from the flower into orbit. */
exports.PETAL_SPAWN_GLIDE_MS = 300;
/** The mob a petal was attracted to died: glide back into orbit. */
exports.PETAL_RELEASE_GLIDE_MS = 250;
/** 1/s first-order approach rate (~95% converged in 220ms). */
exports.PETAL_GLIDE_RATE = 14;
/** Spring force back to the orbit position, px/s^2. */
exports.PETAL_SPRING_FORCE = 600;
/** Velocity damping per substep (0-1, lower = more damping). */
exports.PETAL_DAMPING = 0.72;
/** Time in ms over which spring force ramps up after a (re)spawn. */
exports.PETAL_SPAWN_SMOOTH_TIME = 300;
/**
 * Substep cap for the orbit spring.
 *
 * The semi-implicit Euler spring below is unconditionally unstable once dt
 * exceeds sqrt(2*(1+damping)/(damping*springForce)) — ~0.089s at the defaults —
 * because the tracked error's per-tick growth factor passes -(1+damping) and
 * diverges with no restoring force able to recover it. That is how a petal
 * "flies off and never returns". server.ts's delta smoothing allows dt up to
 * 0.1s under load, which is past the threshold, so the integration is substepped
 * to keep each slice safely below it regardless of real tick time.
 */
const SPRING_SUBSTEP_DT = 0.05;
const SPRING_MAX_SUBSTEPS = 4;
/**
 * Extra angular kick applied on top of the projection point's own rotation when
 * a petal is whipping around a mob. Most of the spin falls out for free from the
 * player orbit dragging the projection point around the mob's edge each frame;
 * this makes it feel snappier. Bigger = faster whip.
 */
const MOB_ORBIT_SPIN_BOOST = 2;
/** Fraction of a mob's radius the attracted petal orbits at (slightly inside). */
const MOB_ORBIT_RADIUS_SCALE = 0.85;
/**
 * Loadout slots that put petals in orbit. Slots 10+ are storage only.
 * Mirrors the `i >= 10` guard the legacy layout used.
 */
exports.PRIMARY_LOADOUT_SLOTS = 10;
/**
 * Stride used to pack (loadoutIndex, instanceIndex) into one integer key.
 *
 * Comfortably above any configured `count` (the largest in petals.ts is 10) and
 * a power of two, so the pack is a shift. A count that somehow exceeded this
 * would COLLIDE keys between adjacent slots rather than error, so
 * `layoutPetalRing` refuses such a count outright.
 */
const PETAL_SLOT_STRIDE = 1024;
/** Pack an instance's stable identity into one integer. */
function petalInstanceKey(loadoutIndex, instanceIndex) {
    return loadoutIndex * PETAL_SLOT_STRIDE + instanceIndex;
}
/**
 * Expand a loadout into one ring entry per petal instance, assigning orbit
 * slots.
 *
 * Ported from `buildPetalInstances`. Petals with `count` occupy `count` slots;
 * `clumped` petals share ONE slot so their instances cluster around a single
 * ring position instead of spreading evenly. The returned slot count is the ring
 * divisor — `angleStep = 2*PI / slotCount`.
 *
 * `out` is cleared and refilled so the caller can keep one array for the whole
 * server lifetime; the ring is rebuilt every tick for every player and
 * allocating a fresh array each time showed up in profiles.
 *
 * The per-instance SIDE EFFECTS the legacy function also performed (sizing the
 * instanceHealth arrays, seeding petal action states) stay with the caller:
 * they touch the loadout Item and the action VM, neither of which is ECS state.
 */
function layoutPetalRing(slots, statsOf, out) {
    out.length = 0;
    let nextSlotIndex = 0;
    for (let i = 0; i < slots.length; i++) {
        // Secondary loadout (slots 10+) is storage only — no orbit, no ring slot.
        if (i >= exports.PRIMARY_LOADOUT_SLOTS)
            continue;
        const petal = slots[i];
        if (!petal || petal.type !== 'petal' || !petal.petalType || !petal.rarity)
            continue;
        const stats = statsOf(petal);
        if (!stats)
            continue;
        const count = stats.count || 1;
        // A bad count would either spin the inner loop forever or collide packed
        // instance keys between adjacent slots. Refuse it, as the original did.
        if (typeof count !== 'number' || count < 1 || !isFinite(count)
            || count > PETAL_SLOT_STRIDE) {
            console.warn('Invalid petal count:', count, 'for', petal.petalType, petal.rarity);
            continue;
        }
        const clumped = !!stats.clumped;
        const sharedSlot = nextSlotIndex;
        for (let j = 0; j < count; j++) {
            const slotIndex = clumped ? sharedSlot : nextSlotIndex;
            if (!clumped)
                nextSlotIndex++;
            out.push({ petal, instanceIndex: j, loadoutIndex: i, slotIndex });
        }
        if (clumped)
            nextSlotIndex++;
    }
    return nextSlotIndex;
}
/**
 * One flower's petal kinematics, stored in the `PetalRing` component.
 *
 * Keyed by the instance's STABLE identity — (loadoutIndex, instanceIndex) — not
 * by its position in the ring, because ring position shifts whenever any earlier
 * slot's count changes and a shifted key would hand slot 5's petal slot 3's
 * momentum.
 *
 * Owned by the entity: when the player entity is destroyed the component column
 * slot is cleared and the whole map goes with it. That replaces the global
 * `petalPhysicsStates` map, which needed an explicit prefix-scan cleanup on
 * every disconnect and leaked a flower's entire ring if that call was ever
 * missed.
 */
class PetalRingState {
    constructor() {
        this.instances = new Map();
    }
    /** Live instance count. Diagnostics and tests. */
    get size() {
        return this.instances.size;
    }
    /** The state for an instance, or undefined if it has none yet. */
    peek(loadoutIndex, instanceIndex) {
        return this.instances.get(petalInstanceKey(loadoutIndex, instanceIndex));
    }
    /**
     * The state for an instance, creating it at the flower's centre if absent.
     *
     * A new or reloaded petal starts ON the flower and glides out into orbit
     * (overshoot-free — see the glide branch in `stepPetalKinematics`), which is
     * what makes a reload read as the petal flying back out rather than
     * teleporting into place.
     */
    acquire(loadoutIndex, instanceIndex, playerX, playerY, now) {
        const key = petalInstanceKey(loadoutIndex, instanceIndex);
        let state = this.instances.get(key);
        if (state === undefined) {
            state = {
                x: playerX,
                y: playerY,
                vx: 0,
                vy: 0,
                spawnTime: now,
                glideUntil: now + exports.PETAL_SPAWN_GLIDE_MS,
                attractedEnemyId: undefined,
            };
            this.instances.set(key, state);
        }
        return state;
    }
    /**
     * Forget one instance's spring state.
     *
     * Called when an instance breaks, so its reload re-initialises at the
     * flower's centre and flies back out instead of resuming from wherever it
     * was floating when it died.
     */
    dropInstance(loadoutIndex, instanceIndex) {
        this.instances.delete(petalInstanceKey(loadoutIndex, instanceIndex));
    }
    /** Forget every instance of one loadout slot (a whole-slot break). */
    dropSlot(loadoutIndex) {
        const first = petalInstanceKey(loadoutIndex, 0);
        const end = first + PETAL_SLOT_STRIDE;
        for (const key of this.instances.keys()) {
            if (key >= first && key < end)
                this.instances.delete(key);
        }
    }
    /** Drop everything. For tests and for a clean world rebuild. */
    clear() {
        this.instances.clear();
    }
}
exports.PetalRingState = PetalRingState;
/**
 * The neutral orbit radius before extension.
 *
 * Only the BODY-RADIUS portion is scaled by `sizeMultiplier`, so petals stay a
 * constant distance from the flower's edge as it grows rather than being flung
 * outward proportionally.
 */
function neutralOrbitRadius(playerSize, sizeMultiplier) {
    return 60 + (playerSize / 2) * (sizeMultiplier - 1);
}
/** Derive this tick's ring constants. */
function computeRingGeometry(input) {
    const neutral = neutralOrbitRadius(input.playerSize, input.sizeMultiplier);
    return {
        playerX: input.playerX,
        playerY: input.playerY,
        orbitPhase: input.orbitPhase,
        angleStep: input.slotCount > 0 ? (Math.PI * 2) / input.slotCount : 0,
        baseRadius: neutral * input.petalExtension,
        // Defend-only petals (rose) never fly out while attacking — their
        // extension is clamped at the neutral orbit, though they still pull in
        // on defend (<1).
        defendOnlyBaseRadius: neutral * Math.min(input.petalExtension, 1.0),
        rangeModifier: input.rangeModifier,
        rotationSpeedModifier: input.rotationSpeedModifier,
        attractionRadius: input.attractionRadius,
        deltaTime: input.deltaTime,
        now: input.now,
    };
}
/**
 * Advance the orbit phase.
 *
 * The rotation-speed modifier is INTEGRATED rather than multiplied into the
 * clock: swapping a petal that changes the modifier (Faster, Yin Yang) must bend
 * the rate from that point forward, where remapping `now * newSpeed` would yank
 * every petal to a different angle on the tick the swap lands.
 */
function advanceOrbitPhase(orbitPhase, rotationSpeedModifier, deltaTime) {
    return orbitPhase + rotationSpeedModifier * deltaTime;
}
/**
 * The orbit point an instance is springing toward.
 *
 * Shared by the main petal loop AND by the field-drop pre-pass (pollen puffs and
 * thrown webs land at their instance's own orbit position), so the two cannot
 * drift apart.
 *
 * `effectiveSize` is the petal's `customSize` override when it has one, else
 * `stats.size` — the caller resolves it because the override lives on the
 * loadout Item.
 */
function petalOrbitTarget(geom, stats, slotIndex, instanceIndex, effectiveSize, out) {
    const baseAngle = slotIndex * geom.angleStep;
    // The per-petal speed times the integrated phase. The `* 2` preserves the
    // original 0.002 rad/ms x 1000 ms/s rate; the modulo is kept because the
    // legacy expression had it and removing it perturbs the low bits.
    const rotationAngle = ((stats.speed ?? 1.0) * geom.orbitPhase * 2) % (Math.PI * 2);
    // Fixed-direction petals don't orbit — they hold a fixed relative bearing.
    const totalAngle = stats.fixedDirection !== undefined ? baseAngle : baseAngle + rotationAngle;
    const range = (stats.range ?? 1.0) * geom.rangeModifier;
    const radius = (stats.defendOnly ? geom.defendOnlyBaseRadius : geom.baseRadius) * range;
    let x = geom.playerX + Math.cos(totalAngle) * radius;
    let y = geom.playerY + Math.sin(totalAngle) * radius;
    // Clumped petals arrange their instances in a small cluster around the
    // single slot centre they share.
    const clumpCount = stats.count || 1;
    if (stats.clumped && clumpCount > 1) {
        const clumpSpacing = effectiveSize * 40 * 0.5;
        const subAngle = (instanceIndex / clumpCount) * Math.PI * 2 + totalAngle;
        x += Math.cos(subAngle) * clumpSpacing;
        y += Math.sin(subAngle) * clumpSpacing;
    }
    out.x = x;
    out.y = y;
    out.angle = totalAngle;
    out.range = range;
}
/** Scratch, reused across every instance of every player. */
const orbitScratch = { x: 0, y: 0, angle: 0, range: 0 };
/**
 * Advance one petal instance and report where it is.
 *
 * Three mutually exclusive position modes, exactly as before:
 *
 *   fixedDirection   pinned to the flower's centre; no state, no physics
 *   range 0/noPhysics snapped to the orbit point; no state, no physics
 *   otherwise        spring/glide physics against the (possibly redirected)
 *                    orbit point, with per-instance state
 *
 * `wallCollide` applies to all three, and writes the resolved position back into
 * the physics state (killing the velocity into the wall) so the spring does not
 * keep driving the petal back inside on the next tick.
 */
function stepPetalKinematics(ring, geom, stats, loadoutIndex, instanceIndex, slotIndex, effectiveSize, deps, out) {
    petalOrbitTarget(geom, stats, slotIndex, instanceIndex, effectiveSize, orbitScratch);
    const targetX = orbitScratch.x;
    const targetY = orbitScratch.y;
    const totalAngle = orbitScratch.angle;
    const petalRange = orbitScratch.range;
    out.angle = totalAngle;
    out.homing = false;
    let petalX;
    let petalY;
    if (stats.fixedDirection !== undefined) {
        // Fixed-direction petals sit directly on the flower.
        petalX = geom.playerX;
        petalY = geom.playerY;
    }
    else if (petalRange === 0 || stats.noPhysics) {
        // No lag behind the player: snap straight to the orbit point.
        petalX = targetX;
        petalY = targetY;
    }
    else {
        const springForce = stats.springForce ?? exports.PETAL_SPRING_FORCE;
        const damping = stats.damping ?? exports.PETAL_DAMPING;
        const spawnSmoothTime = stats.spawnSmoothTime ?? exports.PETAL_SPAWN_SMOOTH_TIME;
        const state = ring.acquire(loadoutIndex, instanceIndex, geom.playerX, geom.playerY, geom.now);
        // Ramp forces up over the smooth window so a fresh petal does not get
        // slingshotted out of the flower.
        const timeSinceSpawn = state.spawnTime ? geom.now - state.spawnTime : spawnSmoothTime;
        const smoothFactor = Math.min(1.0, timeSinceSpawn / spawnSmoothTime);
        const homing = deps.isHoming(stats, timeSinceSpawn);
        out.homing = homing;
        // Eligibility is measured from the ORBIT point, not from the petal's
        // current physics-displaced position and not from the flower: "30px
        // attraction" then reliably lights up when a mob is 30px from where the
        // petal will naturally swing past.
        let target = null;
        if (geom.attractionRadius > 0 && !homing) {
            target = deps.findAttractionTarget(targetX, targetY, geom.attractionRadius);
        }
        let effectiveTargetX = targetX;
        let effectiveTargetY = targetY;
        if (target) {
            state.attractedEnemyId = target.id;
        }
        else if (state.attractedEnemyId !== undefined) {
            const releasedFrom = state.attractedEnemyId;
            state.attractedEnemyId = undefined;
            if (!deps.isEnemyPresent(releasedFrom)) {
                state.glideUntil = geom.now + exports.PETAL_RELEASE_GLIDE_MS;
            }
        }
        if (target) {
            // Redirect the spring to a point just inside the mob's hitbox edge,
            // along the bearing of the natural orbit point FROM the mob. As the
            // player's orbit rotates, that projection rotates around the mob —
            // so the petal spinning around its victim falls out of the existing
            // rotation with no dedicated angular-motion code.
            const dx = targetX - target.x;
            const dy = targetY - target.y;
            const len = Math.sqrt(dx * dx + dy * dy);
            const mobOrbitRadius = target.radius * MOB_ORBIT_RADIUS_SCALE;
            // Per-frame angular velocity in rad/ms, integrated against this
            // frame's deltaTime below.
            const rotationSpeed = (stats.speed ?? 1.0) * geom.rotationSpeedModifier * 0.002;
            const baseProjectionAngle = len > 0 ? Math.atan2(dy, dx) : totalAngle;
            const projectionAngle = baseProjectionAngle + rotationSpeed * MOB_ORBIT_SPIN_BOOST * (geom.deltaTime * 1000);
            effectiveTargetX = target.x + Math.cos(projectionAngle) * mobOrbitRadius;
            effectiveTargetY = target.y + Math.sin(projectionAngle) * mobOrbitRadius;
        }
        if (homing) {
            // Fly straight home. Re-arming the glide every tick keeps the
            // overshoot-free first-order approach in play instead of the spring,
            // so the petal tracks a moving flower and lands cleanly.
            effectiveTargetX = geom.playerX;
            effectiveTargetY = geom.playerY;
            state.glideUntil = geom.now + exports.PETAL_RELEASE_GLIDE_MS;
        }
        if (state.glideUntil !== 0 && geom.now < state.glideUntil) {
            // Transit glide (spawn fly-out / post-kill release): first-order
            // approach toward the live target. vx/vy track the glide motion so
            // the spring takes over seamlessly when the window closes.
            const approach = 1 - Math.exp(-exports.PETAL_GLIDE_RATE * geom.deltaTime);
            const glideX = state.x + (effectiveTargetX - state.x) * approach;
            const glideY = state.y + (effectiveTargetY - state.y) * approach;
            state.vx = (glideX - state.x) / geom.deltaTime;
            state.vy = (glideY - state.y) / geom.deltaTime;
            state.x = glideX;
            state.y = glideY;
        }
        else {
            if (state.glideUntil !== 0)
                state.glideUntil = 0;
            const substeps = Math.min(SPRING_MAX_SUBSTEPS, Math.max(1, Math.ceil(geom.deltaTime / SPRING_SUBSTEP_DT)));
            const subDt = geom.deltaTime / substeps;
            for (let sub = 0; sub < substeps; sub++) {
                const springDx = effectiveTargetX - state.x;
                const springDy = effectiveTargetY - state.y;
                const springDistance = Math.sqrt(springDx * springDx + springDy * springDy);
                let springFx = 0;
                let springFy = 0;
                if (springDistance > 0) {
                    const nx = springDx / springDistance;
                    const ny = springDy / springDistance;
                    // Force proportional to distance, ramped by the spawn smooth
                    // factor.
                    springFx = nx * springForce * springDistance * subDt * smoothFactor;
                    springFy = ny * springForce * springDistance * subDt * smoothFactor;
                }
                state.vx += springFx;
                state.vy += springFy;
                state.vx *= damping;
                state.vy *= damping;
                state.x += state.vx * subDt;
                state.y += state.vy * subDt;
            }
            // Defence in depth: if the integrator ever goes non-finite anyway,
            // self-heal to the target rather than leaving the petal stranded
            // forever at NaN.
            if (!Number.isFinite(state.x) || !Number.isFinite(state.y)) {
                state.x = effectiveTargetX;
                state.y = effectiveTargetY;
                state.vx = 0;
                state.vy = 0;
            }
        }
        petalX = state.x;
        petalY = state.y;
    }
    if (stats.wallCollide) {
        const resolved = deps.resolveWall(petalX, petalY, 40 * effectiveSize);
        if (resolved.collided) {
            petalX = resolved.x;
            petalY = resolved.y;
            // Persist the resolved position and kill the velocity into the wall,
            // or the spring drives the petal straight back inside next frame.
            // `peek`, not `acquire`: the fixedDirection and noPhysics modes have
            // no state and must not gain one here.
            const state = ring.peek(loadoutIndex, instanceIndex);
            if (state) {
                state.x = petalX;
                state.y = petalY;
                state.vx = 0;
                state.vy = 0;
            }
        }
    }
    out.x = petalX;
    out.y = petalY;
}
