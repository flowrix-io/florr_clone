/**
 * The "nothing is under test here" half of an EcsRuntimeOptions.
 *
 * Every bench and cutover check in this directory needs a runtime, and each
 * only exercises one or two schedulers — so each carried its own hand-copy of
 * the same ~20 no-op hooks, differing only in the comment beside each stub.
 * Spread this and override the handful the bench actually cares about:
 *
 *     createEcsRuntime({ ...benchStubHooks(), lookupPlayer: id => players[id] })
 *
 * Anything a bench leaves stubbed is, by construction, not what it measures.
 */
import type { EcsRuntimeOptions } from '../../server/ecsRuntime';

export function benchStubHooks(): EcsRuntimeOptions {
    return {
        lookupPlayer: () => undefined,
        // The benches drive the schedulers directly; the post-movement pipeline
        // is the game's, not the bench's.
        runPlayerPipeline: () => { /* stub */ },
        runPetalBehaviours: () => { /* stub */ },
        // Damage attribution, drops and XP.
        creditDamage: () => { /* stub */ },
        onEnemyDamaged: () => { /* stub */ },
        onEnemyKilled: () => { /* stub */ },
        onPetOutOfView: () => { /* stub */ },
        isNearAnyPlayer: () => true,
        // Wire ids and player-side hooks are broadcast/legacy concerns; they
        // only need to be callable.
        allocateProjectileNetId: () => 1,
        resolvePlayerEntity: () => undefined,
        playerRadiusOf: () => 25,
        damageMultiplierOf: () => 1,
        onPlayerHit: () => true,
        emitEnemyDamaged: () => { /* stub */ },
        onProjectileKill: () => { /* stub */ },
        onGroundEffectExpired: () => { /* stub */ },
        onEnemyPoisonDamaged: () => { /* stub */ },
        onPoisonKill: () => { /* stub */ },
        tickPlayerPoison: () => { /* stub */ },
        onPlayerPoisonLapsed: () => { /* stub */ },
        isDespawnProtectedAt: () => false,
        isItemOutOfBounds: () => false,
        onSpawnEscort: () => { /* stub */ },
        onSpawnWaves: () => { /* stub */ },
        onWorldItemRemoved: () => { /* stub */ },
        onMobDespawn: () => { /* stub */ },
        onReapEnemy: () => { /* stub */ },
    };
}
