"use strict";
/**
 * Self-test for the mob LOD field (systems/lod.ts).
 *
 * The properties worth pinning are the ones whose failure is INVISIBLE: an
 * empty field that returns false would silently run the whole world at a fifth
 * speed, a radius measured wrong would let players watch mobs step at 6Hz, and
 * a stride keyed off nothing would step every distant mob on the same tick and
 * simply relocate the spike this exists to remove.
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
exports.runLodSelfTest = runLodSelfTest;
const entity_1 = require("../entity");
const world_1 = require("../world");
const C = __importStar(require("../components"));
const prefabs_1 = require("../prefabs");
const system_1 = require("../system");
const lod_1 = require("./lod");
function runLodSelfTest() {
    const failures = [];
    const check = (name, condition, detail) => {
        if (!condition)
            failures.push(detail ? `${name}: ${detail}` : name);
    };
    const checkEqual = (name, actual, expected) => {
        if (actual !== expected)
            failures.push(`${name}: expected ${String(expected)}, got ${String(actual)}`);
    };
    // -- the permissive default ----------------------------------------------
    {
        const field = new lod_1.MobActivityField();
        check('empty field treats everything as active', field.isActive(1e6, -1e6));
        check('empty field steps every mob every tick', field.shouldStep((0, entity_1.makeEntity)(7, 1), 1e6, -1e6, 1));
        // ...and stops being permissive the moment a player exists, or the
        // whole mechanism would be a no-op in production.
        field.add(0, 0);
        check('a populated field is no longer permissive', !field.isActive(lod_1.MOB_ACTIVE_RADIUS * 3, 0));
    }
    // -- the radius is measured as a radius, not a box ------------------------
    {
        const field = new lod_1.MobActivityField();
        field.add(0, 0);
        check('mob on top of a player is active', field.isActive(0, 0));
        check('mob just inside the radius is active', field.isActive(lod_1.MOB_ACTIVE_RADIUS - 1, 0));
        check('mob just outside the radius is not', !field.isActive(lod_1.MOB_ACTIVE_RADIUS + 1, 0));
        // The diagonal is the case a box test gets wrong: (r, r) is 1.41r away
        // and must read as distant even though both axes are within r.
        check('diagonal distance is euclidean, not per-axis', !field.isActive(lod_1.MOB_ACTIVE_RADIUS * 0.8, lod_1.MOB_ACTIVE_RADIUS * 0.8));
    }
    // -- any player counts, not just the first --------------------------------
    {
        const field = new lod_1.MobActivityField();
        field.add(0, 0);
        field.add(50000, 50000);
        check('a mob near the SECOND player is active', field.isActive(50000, 50000));
        check('a mob near neither is not', !field.isActive(25000, 25000));
        field.clear();
        check('clear() restores the permissive default', field.isActive(25000, 25000));
    }
    // -- non-finite player positions are ignored ------------------------------
    {
        // A NaN player coordinate would make every distance comparison false,
        // which reads as "everything is distant" — the entire world at a fifth
        // speed because one player's position went bad.
        const field = new lod_1.MobActivityField();
        field.add(NaN, 0);
        check('a NaN player is not recorded', field.isActive(1e6, 1e6));
        field.add(0, 0);
        check('a NaN player does not mask a real one', field.isActive(10, 10));
        check('a real player still bounds the field', !field.isActive(1e6, 1e6));
    }
    // -- distant mobs are strided, and spread across the stride ---------------
    {
        const field = new lod_1.MobActivityField();
        field.add(0, 0);
        const far = lod_1.MOB_ACTIVE_RADIUS * 10;
        // One mob: steps exactly once per stride window.
        const mob = (0, entity_1.makeEntity)(3, 1);
        let stepped = 0;
        for (let tick = 0; tick < lod_1.MOB_FAR_STRIDE * 20; tick++) {
            if (field.shouldStep(mob, far, 0, tick))
                stepped++;
        }
        checkEqual('a distant mob steps once per stride', stepped, 20);
        // A near mob is never strided, however many ticks pass.
        let nearSteps = 0;
        for (let tick = 0; tick < lod_1.MOB_FAR_STRIDE * 20; tick++) {
            if (field.shouldStep(mob, 10, 10, tick))
                nearSteps++;
        }
        checkEqual('a near mob steps every tick', nearSteps, lod_1.MOB_FAR_STRIDE * 20);
        // Across many mobs on ONE tick, the work must be spread — if every
        // distant mob shared a phase, the stride would move the spike rather
        // than flatten it.
        let steppedThisTick = 0;
        const population = lod_1.MOB_FAR_STRIDE * 40;
        for (let slot = 0; slot < population; slot++) {
            if (field.shouldStep((0, entity_1.makeEntity)(slot, 1), far, 0, 0))
                steppedThisTick++;
        }
        checkEqual('distant work is spread evenly over the stride', steppedThisTick, population / lod_1.MOB_FAR_STRIDE);
    }
    // -- the refresh system reads live player positions -----------------------
    {
        const world = new world_1.World();
        const scheduler = new system_1.Scheduler(world);
        const field = new lod_1.MobActivityField();
        (0, lod_1.registerMobActivitySystem)(scheduler, field, (0, lod_1.createMobActivityQueries)(world));
        const player = (0, prefabs_1.spawnPlayer)(world, {
            socketId: 'p1', name: 'p1', x: 1000, y: 1000,
            health: 100, maxHealth: 100, damage: 10, radius: 25,
            inventory: [], loadout: [], now: 0,
        });
        scheduler.tick(1 / 30, 1000 / 30, 1000);
        check('a spawned player makes its surroundings active', field.isActive(1200, 1000));
        check('and leaves the far side of the map distant', !field.isActive(1e6, 1e6));
        // Following the player is the point: a stale field would keep simulating
        // where they WERE and stride where they are.
        world.write(player, C.Position, { x: 400000, y: 400000 });
        scheduler.tick(1 / 30, 1000 / 30, 1033);
        check('the field follows the player', field.isActive(400100, 400000));
        checkEqual('and releases where they left', field.isActive(1200, 1000), false);
        // A disconnect must not leave a phantom activity island behind.
        world.destroy(player);
        scheduler.tick(1 / 30, 1000 / 30, 1066);
        check('an empty world is permissive again', field.isActive(1e9, 1e9));
    }
    return failures;
}
