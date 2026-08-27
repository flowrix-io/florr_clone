"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.benchStubHooks = benchStubHooks;
function benchStubHooks() {
    return {
        lookupPlayer: () => undefined,
        // The benches drive the schedulers directly; the post-movement pipeline
        // is the game's, not the bench's.
        runPlayerPipeline: () => { },
        runPetalBehaviours: () => { },
        // Damage attribution, drops and XP.
        creditDamage: () => { },
        onEnemyDamaged: () => { },
        onEnemyKilled: () => { },
        onPetOutOfView: () => { },
        isNearAnyPlayer: () => true,
        // Wire ids and player-side hooks are broadcast/legacy concerns; they
        // only need to be callable.
        allocateProjectileNetId: () => 1,
        resolvePlayerEntity: () => undefined,
        playerRadiusOf: () => 25,
        damageMultiplierOf: () => 1,
        onPlayerHit: () => true,
        emitEnemyDamaged: () => { },
        onProjectileKill: () => { },
        onGroundEffectExpired: () => { },
        onEnemyPoisonDamaged: () => { },
        onPoisonKill: () => { },
        tickPlayerPoison: () => { },
        onPlayerPoisonLapsed: () => { },
        isDespawnProtectedAt: () => false,
        isItemOutOfBounds: () => false,
        onSpawnEscort: () => { },
        onSpawnWaves: () => { },
        onWorldItemRemoved: () => { },
        onMobDespawn: () => { },
        onReapEnemy: () => { },
    };
}
