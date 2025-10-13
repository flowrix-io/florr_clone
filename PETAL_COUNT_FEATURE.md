# Petal Count Feature

## Overview
Added a new `count` attribute to the `PetalStats` interface that allows petals to spawn multiple instances per equipped item.

## Changes Made

### 1. PetalStats Interface (src/petals.ts)
- Added `count: number` property to the `PetalStats` interface
- This determines how many petal instances spawn for each equipped item
- Default value: 1 (maintains backward compatibility)

### 2. All Petal Configurations Updated
All petal configurations in `PETAL_CONFIG` now include the `count` property:
- **Basic Petals**: All rarities set to `count: 1`
- **Rose Petals**: 
  - Common rarity set to `count: 3` (demonstration)
  - Other rarities set to `count: 1`
- **Stinger Petals**: 
  - Common rarity set to `count: 2` (demonstration)
  - Other rarities set to `count: 1`

### 3. Graphics Rendering (src/graphics.ts)
Updated `drawPlayerPetals()` method to:
- Expand petals based on their `count` property
- Create multiple instances of each petal item
- Distribute all instances evenly around the player

### 4. Server-Side Collision Detection (src/server.ts)
Updated petal-enemy collision detection to:
- Build array of petal instances considering the `count` property
- Calculate positions for all petal instances
- Handle collisions correctly for each instance

## How to Use

To configure different petal counts, simply modify the `count` property in the petal configuration:

```typescript
basic: {
    common: {
        name: "Basic Petal",
        damage: 10,
        health: 10,
        size: 2.0,
        speed: 1.0,
        cooldown: 1200,
        knockback: 1,
        description: "A simple petal that provides basic protection",
        color: "#90EE90",
        count: 5, // This petal will spawn 5 instances per equipped item
        image: `...`
    }
}
```

## Examples

### Current Configuration:
- **Basic Petal (Common)**: 1 petal per item
- **Rose Petal (Common)**: 3 petals per item
- **Stinger (Common)**: 2 petals per item

### Visual Effect:
If a player equips:
- 1 Basic Petal → 1 petal orbits around them
- 1 Rose Petal → 3 petals orbit around them
- 1 Stinger → 2 petals orbit around them
- **Total**: 6 petals evenly distributed around the player

## Benefits

1. **Flexibility**: Game designers can balance petals by adjusting count, damage, and health independently
2. **Visual Variety**: Some petals can create denser protective rings
3. **Gameplay Depth**: High-count petals provide more coverage but may have lower individual stats
4. **Backward Compatible**: Existing petals default to count: 1

## Technical Notes

- All petal instances from the same item share the same health pool
- Instances rotate together around the player
- Collision detection works independently for each instance
- Petal cooldown applies to the entire item (all instances)

