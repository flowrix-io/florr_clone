"use strict";
/**
 * Worker-side half of the collision pool.
 *
 * Maps the shared buffers once, then parks on the control block. Each tick the
 * main thread bumps the generation, this wakes, runs the identical kernel over
 * its assigned range, decrements the pending count and goes back to sleep. It
 * never allocates and never messages — the whole handshake is two Atomics ops.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const worker_threads_1 = require("worker_threads");
const mobCollisionKernel_1 = require("../ecs/systems/mobCollisionKernel");
const collisionWorkerPool_1 = require("./collisionWorkerPool");
const { buffers, index } = worker_threads_1.workerData;
const control = new Int32Array(buffers.control);
const params = new Float64Array(buffers.params);
const ranges = new Int32Array(buffers.ranges);
const contactMeta = new Int32Array(buffers.contactMeta);
const slabSize = buffers.contactsPerWorker;
const output = {
    deltaX: new Float64Array(buffers.deltaX),
    deltaY: new Float64Array(buffers.deltaY),
    contactA: new Int32Array(buffers.contactA, index * slabSize * 4, slabSize),
    contactB: new Int32Array(buffers.contactB, index * slabSize * 4, slabSize),
    contactCount: 0,
    contactOverflow: 0,
};
const input = {
    x: new Float64Array(buffers.x),
    y: new Float64Array(buffers.y),
    radius: new Float32Array(buffers.radius),
    head: new Float64Array(buffers.head),
    flags: new Uint8Array(buffers.flags),
    cellStart: new Int32Array(buffers.cellStart),
    sorted: new Int32Array(buffers.sorted),
    hashKeys: new Int32Array(buffers.hashKeys),
    hashVals: new Int32Array(buffers.hashVals),
    hashMask: 0,
    count: 0,
    maxRadius: 0,
    cellSize: 0,
    collisionBuffer: 0,
    maxPushPerPair: 0,
    nullHead: 0,
};
let seen = 0;
for (;;) {
    // Sleep until the generation moves. The timeout is a liveness backstop: a
    // missed notify would otherwise park this thread forever.
    if (Atomics.load(control, collisionWorkerPool_1.CONTROL_SLOTS.CTL_GENERATION) === seen) {
        Atomics.wait(control, collisionWorkerPool_1.CONTROL_SLOTS.CTL_GENERATION, seen, 1000);
        continue;
    }
    seen = Atomics.load(control, collisionWorkerPool_1.CONTROL_SLOTS.CTL_GENERATION);
    if (Atomics.load(control, collisionWorkerPool_1.CONTROL_SLOTS.CTL_SHUTDOWN) === 1)
        break;
    input.count = params[collisionWorkerPool_1.PARAM_SLOTS.P_COUNT];
    input.maxRadius = params[collisionWorkerPool_1.PARAM_SLOTS.P_MAX_RADIUS];
    input.cellSize = params[collisionWorkerPool_1.PARAM_SLOTS.P_CELL_SIZE];
    input.collisionBuffer = params[collisionWorkerPool_1.PARAM_SLOTS.P_BUFFER];
    input.maxPushPerPair = params[collisionWorkerPool_1.PARAM_SLOTS.P_MAX_PUSH];
    input.nullHead = params[collisionWorkerPool_1.PARAM_SLOTS.P_NULL_HEAD];
    input.hashMask = params[collisionWorkerPool_1.PARAM_SLOTS.P_HASH_MASK];
    try {
        (0, mobCollisionKernel_1.scanRange)(input, ranges[index * 2], ranges[index * 2 + 1], output);
        contactMeta[index * 2] = output.contactCount;
        contactMeta[index * 2 + 1] = output.contactOverflow;
    }
    catch (err) {
        // Never leave the main thread waiting on a barrier we cannot reach.
        contactMeta[index * 2] = 0;
        contactMeta[index * 2 + 1] = 0;
        worker_threads_1.parentPort?.postMessage({ error: String(err) });
    }
    finally {
        Atomics.sub(control, collisionWorkerPool_1.CONTROL_SLOTS.CTL_PENDING, 1);
        Atomics.notify(control, collisionWorkerPool_1.CONTROL_SLOTS.CTL_PENDING);
    }
}
