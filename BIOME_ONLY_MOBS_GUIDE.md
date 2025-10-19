# Biome-Only Mobs Feature

## Overview

Mobs can now be configured to spawn **only in biomes** and never in regular spawn zones. This allows you to create exclusive mobs that only appear in special biome areas.

## Configuration

### Setting a Mob as Biome-Only

In `src/mobs.ts`, add the `biomeOnly: true` property to a mob's base configuration:

```typescript
const BASE_MOB_CONFIGS: { [mobType: string]: BaseMobConfig } = {
    // Example: Make sharks biome-only
    shark: {
        name: "Common Shark",
        damage: 80,
        health: 50,
        size: 1.2,
        speed: 0.7,
        cooldown: 1800,
        description: "A dangerous predator of the deep",
        color: "#4682B4",
        image: `<svg>...</svg>`,
        is_hostile: true,
        range: 800,
        biomeOnly: true  // ← This makes sharks only spawn in biomes
    },
    
    // Regular mob (spawns anywhere)
    fish: {
        name: "Common Fish",
        damage: 30,
        health: 25,
        // ... other properties
        // No biomeOnly property = can spawn anywhere
    }
};
```

### Rarity-Specific Overrides

You can also make specific rarities biome-only using rarity overrides:

```typescript
const RARITY_OVERRIDES: { [mobType: string]: { [rarity: string]: RarityOverride } } = {
    octopus: {
        mythic: {
            name: "Abyssal Octopus",
            description: "A creature from the deepest trenches",
            biomeOnly: true  // Only mythic octopuses are biome-only
        }
    }
};
```

## How It Works

### Spawn Behavior

#### In Biomes
- ✅ **All mobs can spawn** (including biome-only mobs)
- Follows the biome's spawn table
- If spawn table specifies a biome-only mob type, it spawns normally
- If spawn table doesn't specify mob type, biome-only mobs are included in random selection

#### In Regular Spawn Zones
- ✅ **Only non-biome-only mobs spawn**
- Biome-only mobs are filtered out
- Normal spawn logic applies to remaining mobs
- If all mobs at a tier are biome-only, no mob spawns

#### Outside Spawn Zones (World Areas)
- ✅ **Only non-biome-only mobs spawn**
- Same filtering as regular spawn zones
- Uses normal probability distribution

### Code Implementation

**Server Logic** (`src/server.ts`):
```typescript
// When spawning outside biomes
const eligibleMobTypes = allMobTypes.filter(type => {
    const stats = getMobStats(type, tier);
    return stats && !stats.biomeOnly;  // Filter out biome-only mobs
});
```

**Mob Stats** (`src/mobs.ts`):
```typescript
export interface MobStats {
    // ... other properties
    biomeOnly: boolean;  // Whether this mob can only spawn in biomes
}
```

## Use Cases

### 1. Exclusive Boss Mobs
Create special boss mobs that only appear in dangerous biome areas:

```typescript
kraken: {
    name: "Common Kraken",
    damage: 150,
    health: 200,
    size: 2.0,
    speed: 0.4,
    cooldown: 3000,
    description: "Legendary sea monster of the abyss",
    color: "#8B008B",
    image: `<svg>...</svg>`,
    is_hostile: true,
    range: 1200,
    biomeOnly: true
}
```

Then create a biome with this mob:
```json
{
  "type": "biome",
  "x": 15000,
  "y": 15000,
  "width": 3000,
  "height": 3000,
  "properties": {
    "biomeName": "kraken_lair",
    "backgroundTexture": "deep_ocean.svg",
    "spawnTable": [
      { "mobType": "kraken", "tier": "legendary", "weight": 1 }
    ]
  }
}
```

### 2. Regional Variants
Create mob variants that only appear in specific regions:

```typescript
tropical_fish: {
    name: "Tropical Fish",
    damage: 20,
    health: 30,
    size: 0.9,
    speed: 0.6,
    cooldown: 2000,
    description: "Colorful fish found only in warm waters",
    color: "#FFD700",
    image: `<svg>...</svg>`,
    is_hostile: false,
    range: 400,
    biomeOnly: true
}
```

### 3. Tier-Specific Restrictions
Make only high-tier variants biome-only:

```typescript
const RARITY_OVERRIDES = {
    dragon: {
        ultra: {
            biomeOnly: true  // Only ultra dragons are biome-only
        },
        super: {
            biomeOnly: true  // Only super dragons are biome-only
        },
        unique: {
            biomeOnly: true  // Only unique dragons are biome-only
        }
    }
};
```

## Biome Spawn Table Integration

### Specifying Biome-Only Mobs

In your biome spawn table, you can explicitly include biome-only mobs:

```json
{
  "type": "biome",
  "properties": {
    "biomeName": "exotic_zone",
    "spawnTable": [
      { "mobType": "kraken", "tier": "legendary", "weight": 2 },
      { "mobType": "tropical_fish", "tier": "rare", "weight": 5 },
      { "mobType": "fish", "tier": "common", "weight": 10 }
    ]
  }
}
```

### Random Selection in Biomes

If you don't specify a mob type, biome-only mobs are included:

```json
{
  "type": "biome",
  "properties": {
    "biomeName": "mixed_exotic",
    "spawnTable": [
      { "tier": "legendary", "weight": 3 },  // Can spawn ANY legendary (including biome-only)
      { "tier": "rare", "weight": 7 }        // Can spawn ANY rare (including biome-only)
    ]
  }
}
```

## Testing Your Biome-Only Mobs

### 1. Verify Regular Zones Exclude Them

1. Set a mob to `biomeOnly: true`
2. Navigate to a regular spawn zone (non-biome)
3. Observe that this mob type never spawns
4. Check server logs for spawn confirmations

### 2. Verify Biomes Include Them

1. Create a biome with biome-only mob in spawn table
2. Navigate to the biome area
3. Observe that the biome-only mob spawns correctly
4. Verify spawn rates match the weight distribution

### 3. Check Mixed Scenarios

1. Create biomes with both regular and biome-only mobs
2. Verify all mobs spawn in biomes
3. Verify only regular mobs spawn outside biomes

## Example Configuration

### Complete Example: Deep Sea Biome with Exclusive Mobs

**Step 1: Define Biome-Only Mobs** (`src/mobs.ts`):

```typescript
const BASE_MOB_CONFIGS = {
    // Biome-only mob
    anglerfish: {
        name: "Common Anglerfish",
        damage: 90,
        health: 60,
        size: 1.3,
        speed: 0.5,
        cooldown: 2200,
        description: "Deep sea predator with bioluminescent lure",
        color: "#1C1C1C",
        image: `<svg>...</svg>`,
        is_hostile: true,
        range: 700,
        biomeOnly: true  // Only spawns in biomes
    },
    
    // Regular mob (can spawn anywhere)
    fish: {
        name: "Common Fish",
        damage: 30,
        health: 25,
        size: 1.0,
        speed: 0.5,
        cooldown: 2000,
        description: "A harmless fish",
        color: "#87CEEB",
        image: `<svg>...</svg>`,
        is_hostile: false,
        range: 500
        // No biomeOnly = spawns everywhere
    }
};
```

**Step 2: Create Deep Sea Biome** (in map JSON):

```json
{
  "type": "biome",
  "x": 10000,
  "y": 10000,
  "width": 4000,
  "height": 4000,
  "properties": {
    "biomeName": "deep_sea_trench",
    "backgroundTexture": "dark_ocean.svg",
    "spawnTable": [
      { "mobType": "anglerfish", "tier": "epic", "weight": 5 },
      { "mobType": "anglerfish", "tier": "legendary", "weight": 2 },
      { "mobType": "fish", "tier": "rare", "weight": 3 }
    ]
  }
}
```

**Result**:
- In the deep sea trench biome: Anglerfish spawn at epic/legendary tiers
- Outside the biome: Only regular fish spawn (anglerfish never appear)

## Best Practices

### 1. Design Philosophy
- Use biome-only for **special/rare mobs** that enhance biome uniqueness
- Don't make too many mobs biome-only (limits mob variety in regular zones)
- Balance biome-only mobs with regular mobs in biomes

### 2. Spawn Tables
- Always include at least some biome-only mobs in their respective biomes
- Consider mixing biome-only and regular mobs for variety
- Use appropriate weight distributions

### 3. Player Experience
- Make biome-only mobs **visually distinctive**
- Ensure biomes are **accessible** but **challenging**
- Reward players for exploring biomes

### 4. Testing
- Test spawn rates in both biomes and regular zones
- Verify mob filtering works correctly
- Check console logs for any spawn errors

## Troubleshooting

### Issue: Biome-Only Mob Not Spawning in Biome

**Check**:
1. Is the mob correctly added to the biome's spawn table?
2. Is the spawn table properly formatted?
3. Are there any console errors about mob spawning?
4. Is the mobType spelled correctly in spawn table?

### Issue: Biome-Only Mob Appearing Outside Biome

**Check**:
1. Is `biomeOnly: true` set in BASE_MOB_CONFIGS?
2. Has the code been recompiled after changes?
3. Are there any rarity overrides clearing the biomeOnly flag?
4. Check server logs for spawn confirmations

### Issue: No Mobs Spawning in Regular Zones

**Possible Cause**: All mobs at certain tiers might be biome-only

**Solution**:
1. Check which mobs are marked as biomeOnly
2. Ensure at least some mobs at each tier are not biome-only
3. Review your mob configurations

## Performance Considerations

### Minimal Impact
- Filtering is O(n) where n = number of mob types (typically very small)
- Only runs during mob spawn (not every frame)
- No additional memory overhead
- No impact on biome spawning

### Optimization Tips
- Keep total number of mob types reasonable (< 50)
- Use biome-only sparingly for best variety
- Regular zone spawning remains efficient

## API Reference

### Interfaces

```typescript
// MobStats interface
export interface MobStats {
    // ... other properties
    biomeOnly: boolean;  // Whether mob can only spawn in biomes
}

// BaseMobConfig interface
interface BaseMobConfig {
    // ... other properties
    biomeOnly?: boolean;  // Optional: defaults to false
}

// RarityOverride interface
interface RarityOverride {
    // ... other properties
    biomeOnly?: boolean;  // Optional: override biomeOnly per rarity
}
```

### Functions

```typescript
// Get mob stats (includes biomeOnly property)
getMobStats(mobType: string, rarity: string): MobStats | null

// Get all mob types (includes biome-only mobs)
getAllMobTypes(): string[]
```

### Server Logic

```typescript
// Spawn filtering (in createEnemy function)
const eligibleMobTypes = allMobTypes.filter(type => {
    const stats = getMobStats(type, tier);
    return stats && !stats.biomeOnly;  // Excludes biome-only in regular zones
});
```

## Summary

The biome-only mob feature allows you to:
- ✅ Create exclusive mobs that only spawn in biomes
- ✅ Make certain rarities biome-only while others spawn normally
- ✅ Enhance biome uniqueness and exploration value
- ✅ Balance mob distributions across different areas
- ✅ Create special encounters in designated zones

Set `biomeOnly: true` in your mob configuration to restrict spawning to biomes only!

