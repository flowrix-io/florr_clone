# Ocean Survival Game - Technical Design Document

## Core Game Architecture

### Client-Side Components
1. **Game.ts**
   - Main game loop
   - Canvas rendering
   - Input handling
   - Asset management

2. **WorkerBlob.ts**
   - Game state management
   - Physics calculations
   - Enemy AI
   - Collision detection
   - Zone management

3. **Client.ts**
   - WebSocket connection management
   - Event handling
   - State synchronization

### Server-Side Components
1. **Server.ts**
   - WebSocket server
   - Player session management
   - Game instance management

## Game Mechanics

### Player System
- Base Stats:
  ```typescript
  interface PlayerStats {
    maxHealth: 100,
    damage: 10,
    speed: 5,
    inventorySize: 5
  }
  ```

- Level Progression:
  ```typescript
  const levelingFormula = {
    healthGain: 10,  // per level
    damageGain: 2,   // per level
    maxLevel: 50,
    baseXP: 100,
    xpMultiplier: 1.5
  }
  ```

### Zone System
```typescript:DESIGN.md
const ZONE_BOUNDARIES = {
    common:    { start: 0,    end: 2000  },
    uncommon:  { start: 2000, end: 4000  },
    rare:      { start: 4000, end: 6000  },
    epic:      { start: 6000, end: 8000  },
    legendary: { start: 8000, end: 9000  },
    mythic:    { start: 9000, end: 10000 }
}
```

### Enemy System
- Types:
  1. Octopus (Random movement)
  2. Fish (Directional movement)

- Tier Properties:
  ```typescript
  const ENEMY_TIERS = {
    common:    { health: 20,  speed: 0.5, damage: 5  },
    uncommon:  { health: 40,  speed: 0.75, damage: 10 },
    rare:      { health: 60,  speed: 1.0, damage: 15 },
    epic:      { health: 80,  speed: 1.25, damage: 20 },
    legendary: { health: 100, speed: 1.5, damage: 25 },
    mythic:    { health: 150, speed: 2.0, damage: 30 }
  }
  ```

### Combat System
- Collision Detection:
  ```typescript
  const COLLISION_PARAMS = {
    playerSize: 40,
    enemySize: 40,
    knockbackForce: 20,
    knockbackRecovery: 0.9,
    invulnerabilityTime: 3000
  }
  ```

### Item System
1. Health Potions
   - Restores 50% health
   - Common in all zones

2. Speed Boosts
   - 2x speed for 10 seconds
   - Uncommon+ zones

3. Shields
   - 50% damage reduction
   - Rare+ zones

### Drop System
```typescript
const DROP_CHANCES = {
    common:    0.1,  // 10%
    uncommon:  0.2,  // 20%
    rare:      0.3,  // 30%
    epic:      0.4,  // 40%
    legendary: 0.5,  // 50%
    mythic:    0.75  // 75%
}
```

## Technical Implementation

### Web Worker Architecture
1. Main Thread
   - Rendering
   - Input handling
   - Asset loading
   - WebSocket communication

2. Worker Thread
   - Game state management
   - Physics calculations
   - AI processing
   - Collision detection

### Network Protocol
```typescript
interface NetworkMessage {
    type: 'movement' | 'combat' | 'item' | 'levelup';
    data: any;
    timestamp: number;
}
```

### State Management
1. Player State
   ```typescript
   interface PlayerState {
       position: Vector2D;
       health: number;
       level: number;
       xp: number;
       inventory: Item[];
       effects: StatusEffect[];
   }
   ```

2. Game State
   ```typescript
   interface GameState {
       players: Map<string, PlayerState>;
       enemies: Enemy[];
       items: Item[];
       obstacles: Obstacle[];
   }
   ```

## Performance Optimizations

### Collision Detection
- Zone-based enemy updates
- Quadtree implementation for spatial partitioning
- Broad-phase collision detection

### Network Optimization
- Delta compression
- Position interpolation
- Client-side prediction

### Memory Management
- Object pooling for projectiles
- Enemy recycling
- Efficient asset loading

## Asset Requirements

### Graphics
1. Player
   - Base sprite
   - Attack animation
   - Damage animation

2. Enemies
   - Fish sprites (6 tiers)
   - Octopus sprites (6 tiers)
   - Death animations

3. Environment
   - Coral obstacles
   - Decorative elements
   - Zone backgrounds

### Audio
1. Sound Effects
   - Combat hits
   - Item collection
   - Level up
   - Damage taken

2. Background Music
   - Zone-specific themes
   - Combat intensity variations

## Development Roadmap

### Phase 1: Core Mechanics
- [x] Basic movement
- [x] Combat system
- [x] Zone implementation
- [x] Enemy AI

### Phase 2: Features
- [ ] Item system
- [ ] Leveling system
- [ ] Drop system
- [ ] UI/HUD

### Phase 3: Polish
- [ ] Graphics
- [ ] Sound
- [ ] Performance optimization
- [ ] Bug fixes
```

This design document focuses on the technical implementation details and provides clear specifications for each game system. It's structured to serve as a practical reference during development while maintaining flexibility for future changes and improvements. 