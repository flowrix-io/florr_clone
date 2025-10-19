# Biome-Only Mobs Feature - Implementation Summary

## Overview

Added an optional `biomeOnly` attribute to mob configurations that restricts certain mobs to spawn **only in biomes**, never in regular spawn zones or world areas.

## What Was Implemented

### 1. Mob Configuration Updates (src/mobs.ts)

#### Added to MobStats Interface
```typescript
export interface MobStats {
    // ... existing properties
    biomeOnly: boolean;  // NEW: Whether this mob can only spawn in biomes
}
```

#### Added to BaseMobConfig Interface
```typescript
interface BaseMobConfig {
    // ... existing properties
    biomeOnly?: boolean;  // NEW: Optional property (defaults to false)
}
```

#### Added to RarityOverride Interface
```typescript
interface RarityOverride {
    // ... existing properties
    biomeOnly?: boolean;  // NEW: Can override per rarity
}
```

#### Updated generateMobStats Function
```typescript
function generateMobStats(baseConfig: BaseMobConfig, rarity: Rarity, mobType: string): MobStats {
    return {
        // ... other properties
        biomeOnly: overrides.biomeOnly ?? baseConfig.biomeOnly ?? false  // NEW
    };
}
```

### 2. Server Spawn Logic Updates (src/server.ts)

#### Modified createEnemy Function

Added filtering to exclude biome-only mobs when spawning in regular zones:

```typescript
// When spawning outside biomes (in regular spawn zones or world areas)
const eligibleMobTypes = allMobTypes.filter(type => {
    const stats = getMobStats(type, tier);
    return stats && !stats.biomeOnly;  // Filter out biome-only mobs
});

if (eligibleMobTypes.length === 0) {
    // No eligible mobs for this tier outside biomes
    return null;
}

mobType = eligibleMobTypes[Math.floor(Math.random() * eligibleMobTypes.length)];
```

**Key Behavior**:
- ✅ In biomes: ALL mobs can spawn (including biome-only)
- ✅ In regular spawn zones: Only non-biome-only mobs spawn
- ✅ In world areas: Only non-biome-only mobs spawn

## How to Use

### Basic Usage

Set `biomeOnly: true` in your mob's base configuration:

```typescript
const BASE_MOB_CONFIGS = {
    kraken: {
        name: "Common Kraken",
        damage: 150,
        health: 200,
        size: 2.0,
        speed: 0.4,
        cooldown: 3000,
        description: "Legendary sea monster",
        color: "#8B008B",
        image: `<svg>...</svg>`,
        is_hostile: true,
        range: 1200,
        biomeOnly: true  // ← Only spawns in biomes
    }
};
```

### Rarity-Specific

Make only certain rarities biome-only:

```typescript
const RARITY_OVERRIDES = {
    dragon: {
        mythic: {
            biomeOnly: true  // Only mythic dragons are biome-only
        },
        ultra: {
            biomeOnly: true  // Only ultra dragons are biome-only
        }
    }
};
```

### In Biome Spawn Tables

Include biome-only mobs explicitly:

```json
{
  "type": "biome",
  "properties": {
    "biomeName": "kraken_zone",
    "spawnTable": [
      { "mobType": "kraken", "tier": "legendary", "weight": 5 },
      { "mobType": "fish", "tier": "rare", "weight": 10 }
    ]
  }
}
```

Or use random selection (includes biome-only mobs):

```json
{
  "spawnTable": [
    { "tier": "legendary", "weight": 1 }  // Can spawn ANY legendary (including kraken)
  ]
}
```

## Spawn Logic Flow

### Regular Spawn Zones / World Areas
```
1. Pick spawn location
2. Determine tier
3. Get all mob types
4. FILTER OUT biome-only mobs  ← NEW
5. Pick random mob from remaining types
6. Spawn mob
```

### Biome Spawning
```
1. Pick spawn location in biome
2. Check biome spawn table
3. Select entry from spawn table (with weights)
4. Get tier from entry
5. Get mob type from entry OR pick randomly
   - If random: ALL mob types included (biome-only + regular)  ← IMPORTANT
6. Spawn mob
```

## Use Cases

### 1. Exclusive Boss Mobs
Create special bosses that only appear in dangerous biomes:
- Kraken in deep ocean biomes
- Ancient dragon in volcanic biomes
- Ice titan in frozen biomes

### 2. Regional Exclusives
Create mob variants unique to specific regions:
- Tropical fish in coral reef biomes
- Desert scorpions in desert biomes
- Cave spiders in underground biomes

### 3. High-Tier Restrictions
Make powerful variants biome-exclusive:
- Regular mob: spawns everywhere
- Mythic+ variants: biome-only

### 4. Exploration Rewards
Encourage players to explore biomes by placing unique mobs there:
- Rare resource-dropping mobs
- Special challenge mobs
- Collectible variants

## Benefits

### For Game Design
- ✅ Create unique biome identities
- ✅ Control mob distribution precisely
- ✅ Encourage exploration
- ✅ Balance difficulty zones
- ✅ Add variety to different areas

### For Players
- ✅ Discover exclusive content in biomes
- ✅ Reason to explore different areas
- ✅ Clear visual distinction between zones
- ✅ Predictable spawn patterns
- ✅ Reward for finding special areas

### For Development
- ✅ Simple boolean flag
- ✅ Minimal code changes
- ✅ No performance impact
- ✅ Easy to configure
- ✅ Works with existing systems

## Files Modified

1. ✅ `src/mobs.ts` - Added biomeOnly property to interfaces and generation
2. ✅ `src/server.ts` - Added filtering logic for regular zone spawning

## Files Created

1. ✅ `BIOME_ONLY_MOBS_GUIDE.md` - Complete user guide
2. ✅ `BIOME_ONLY_FEATURE_SUMMARY.md` - This file

## Files Updated

1. ✅ `BIOME_SPAWNER_GUIDE.md` - Added section on biome-only mobs

## Testing

### Test Scenarios

1. **Biome-Only Mob in Biome**: ✅ Should spawn normally
2. **Biome-Only Mob in Spawn Zone**: ✅ Should NOT spawn
3. **Biome-Only Mob in World Area**: ✅ Should NOT spawn
4. **Regular Mob in Biome**: ✅ Should spawn normally
5. **Regular Mob in Spawn Zone**: ✅ Should spawn normally
6. **Regular Mob in World Area**: ✅ Should spawn normally

### Quick Test

1. Set a mob to `biomeOnly: true`
2. Create a biome with that mob in spawn table
3. Navigate to biome → Mob should spawn
4. Navigate to regular zone → Mob should NOT spawn
5. Check server logs for spawn confirmations

## Performance

### Impact: Negligible

- **Filtering**: O(n) where n = number of mob types (typically < 20)
- **Frequency**: Only during mob spawn (not every frame)
- **Memory**: No additional overhead (boolean flag)
- **Biome Spawning**: No change (no filtering)

### Optimization

Current implementation is already optimal:
- Single filter operation
- Runs only when needed
- No caching required (mob list is small)
- No impact on biome spawning

## Backwards Compatibility

✅ **Fully Compatible**

- Existing mobs without `biomeOnly` property default to `false`
- All existing mobs continue to spawn normally
- No breaking changes to existing configurations
- No changes to existing spawn tables required

## API Summary

### New Properties

```typescript
// MobStats
interface MobStats {
    biomeOnly: boolean;  // Default: false
}

// BaseMobConfig
interface BaseMobConfig {
    biomeOnly?: boolean;  // Optional, default: false
}

// RarityOverride
interface RarityOverride {
    biomeOnly?: boolean;  // Optional, overrides base config
}
```

### Spawn Logic

```typescript
// In createEnemy() when spawning outside biomes
const eligibleMobTypes = allMobTypes.filter(type => {
    const stats = getMobStats(type, tier);
    return stats && !stats.biomeOnly;
});
```

## Example Configuration

### Complete Example

**Step 1**: Configure biome-only mob (`src/mobs.ts`):

```typescript
const BASE_MOB_CONFIGS = {
    sea_serpent: {
        name: "Common Sea Serpent",
        damage: 120,
        health: 150,
        size: 1.8,
        speed: 0.6,
        cooldown: 2500,
        description: "Ancient serpent of the deep",
        color: "#006994",
        image: `<svg>...</svg>`,
        is_hostile: true,
        range: 1000,
        biomeOnly: true  // Only spawns in biomes
    },
    
    fish: {
        name: "Common Fish",
        damage: 30,
        health: 25,
        size: 1.0,
        speed: 0.5,
        cooldown: 2000,
        description: "Harmless fish",
        color: "#87CEEB",
        image: `<svg>...</svg>`,
        is_hostile: false,
        range: 500
        // No biomeOnly = spawns everywhere
    }
};
```

**Step 2**: Create biome with exclusive mob (map JSON):

```json
{
  "type": "biome",
  "x": 12000,
  "y": 12000,
  "width": 3500,
  "height": 3500,
  "properties": {
    "biomeName": "serpent_waters",
    "backgroundTexture": "dark_water.svg",
    "spawnTable": [
      { "mobType": "sea_serpent", "tier": "epic", "weight": 3 },
      { "mobType": "sea_serpent", "tier": "legendary", "weight": 1 },
      { "mobType": "fish", "tier": "uncommon", "weight": 6 }
    ]
  }
}
```

**Result**:
- In "serpent_waters" biome: Sea serpents spawn at epic/legendary tiers
- Outside biome: Only regular fish spawn (sea serpents never appear)

## Troubleshooting

### Issue: Biome-Only Mob Not Spawning Anywhere

**Check**:
1. Is mob in a biome's spawn table?
2. Is spawn table format correct?
3. Check server console for errors
4. Verify biomeOnly is set to true

### Issue: Biome-Only Mob Spawning Outside Biome

**Check**:
1. Verify `biomeOnly: true` is in BASE_MOB_CONFIGS
2. Recompile/restart server after changes
3. Check for rarity overrides that might clear the flag
4. Look at server spawn logs

### Issue: No Mobs Spawning in Regular Zones

**Possible Cause**: All mobs might be biome-only

**Solution**: Ensure at least some mobs are not biome-only at each tier

## Best Practices

1. **Balance**: Don't make too many mobs biome-only
2. **Design**: Use for special/exclusive content
3. **Testing**: Test spawn rates in both contexts
4. **Documentation**: Document which mobs are biome-only
5. **Player Communication**: Make biome-only mobs visually distinctive

## Future Enhancements

Potential additions:
- [ ] Zone-specific mobs (not just biome-only)
- [ ] Time-based spawning restrictions
- [ ] Level-based mob restrictions
- [ ] Multiple restriction types (biomeOnly, zoneOnly, etc.)
- [ ] Server config to override biomeOnly settings

## Conclusion

The biome-only mobs feature is **fully implemented and ready to use**. It provides a simple yet powerful way to create exclusive content in biomes, encouraging exploration and adding variety to the game world.

### Quick Reference

**To make a mob biome-only**:
```typescript
biomeOnly: true
```

**Spawn behavior**:
- In biomes: ✅ Spawns normally
- Outside biomes: ❌ Never spawns

**Default**: All mobs can spawn anywhere (biomeOnly = false)

See `BIOME_ONLY_MOBS_GUIDE.md` for complete usage documentation!

