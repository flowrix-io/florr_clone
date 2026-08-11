#!/usr/bin/env node
/**
 * Build and run the ECS core self-test.
 *
 * The project has no test framework, so this compiles src/ecs with its own
 * tsconfig (typechecking counts as half the test) and runs the exported
 * assertion suite, exiting non-zero on the first failing invariant.
 *
 *   npm run test:ecs
 */

const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'dist_ecs_test');

function main() {
    process.stdout.write('Compiling src/ecs ... ');
    try {
        execFileSync(
            process.execPath,
            [path.join(root, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.ecs.json'],
            { cwd: root, stdio: 'pipe' },
        );
    } catch (err) {
        process.stdout.write('FAILED\n\n');
        process.stdout.write(String(err.stdout || '') + String(err.stderr || ''));
        process.exit(1);
    }
    process.stdout.write('ok\n');

    const entry = path.join(outDir, 'ecs', 'ecs_self_test.js');
    if (!fs.existsSync(entry)) {
        console.error(`Compiled self-test missing at ${entry}`);
        process.exit(1);
    }

    const { runEcsSelfTest } = require(entry);
    const { runSystemsSelfTest } = require(path.join(outDir, 'ecs', 'systems', 'systems_self_test.js'));
    const { runGridSelfTest } = require(path.join(outDir, 'ecs', 'spatial', 'grid_self_test.js'));
    const { runPlayerMovementSelfTest } = require(path.join(outDir, 'ecs', 'systems', 'playerMovement_self_test.js'));
    const { runEnemyAiSelfTest } = require(path.join(outDir, 'ecs', 'systems', 'enemyAI_self_test.js'));
    const { runEnemyAiBehaviourSelfTest } = require(path.join(outDir, 'ecs', 'systems', 'enemyAI_behaviour_self_test.js'));
    const { runCombatSelfTest } = require(path.join(outDir, 'ecs', 'systems', 'combat_self_test.js'));
    const { runClientSelfTest } = require(path.join(outDir, 'ecs', 'client', 'client_self_test.js'));
    const failures = [
        ...runEcsSelfTest(),
        ...runSystemsSelfTest(),
        ...runGridSelfTest(),
        ...runPlayerMovementSelfTest(),
        ...runEnemyAiSelfTest(),
        ...runEnemyAiBehaviourSelfTest(),
        ...runCombatSelfTest(),
        ...runClientSelfTest(),
    ];

    if (failures.length === 0) {
        console.log('ECS self-test: ALL PASS');
        return;
    }
    console.log(`ECS self-test: ${failures.length} FAILURE(S)`);
    for (const f of failures) console.log('  x ' + f);
    process.exit(1);
}

main();
