# Server Module Structure

This folder contains the refactored server code, split into logical modules:

## Modules

- **utils.ts** - Utility functions (trackDamage, calculateDPS, getEligiblePlayers, sendBossMobDefeatedMessage)
- **gameState.ts** - Game state management (items, enemies, players, projectiles, etc.)
- **itemManager.ts** - Item drop handling and management
- **playerManager.ts** - Player state, XP, leveling, inventory, respawn functions
- **enemyManager.ts** - Enemy spawning, movement, and management (to be created)
- **projectileManager.ts** - Projectile management (to be created)
- **socketHandlers.ts** - Socket.io event handlers (to be created)
- **gameLoop.ts** - Main game loop and update functions (to be created)
- **crossServer.ts** - Cross-server transfer functionality (to be created)
- **serverSetup.ts** - Express and Socket.io server setup (to be created)
- **index.ts** - Main entry point that exports all modules

## Refactoring Status

The server.ts file (4224 lines) is being refactored into these modules. Some modules are complete, others are placeholders that need to be populated with the appropriate functions from server.ts.

