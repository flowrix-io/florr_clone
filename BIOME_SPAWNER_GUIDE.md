# Biome Spawner System

## Overview

The biome spawner system allows you to create custom areas in the game world with:
1. **Spawn Tables** - Control which mobs spawn and their rarities
2. **Background Textures** - Custom visual appearance for each biome

## Features

- Define custom spawn tables with weighted probability for mob types and tiers
- Specify custom background textures (SVG or image files) for visual variety
- Biomes override normal spawn mechanics within their boundaries
- Multiple biomes can share the same background texture
- Biomes appear on the minimap with a purple tint

## Configuration

### Adding a Biome to the Map

Biomes are defined in the `WORLD_MAP` array in `constants.ts` or loaded from a map JSON file:

```typescript
{
  "type": "biome",
  "x": 5000,
  "y": 5000,
  "width": 2000,
  "height": 2000,
  "properties": {
    "biomeName": "desert",                    // Unique identifier
    "backgroundTexture": "desert.svg",        // Path to texture file
    "spawnTable": [
      {
        "mobType": "octopus",                 // Specific mob type (optional)
        "tier": "rare",                        // Mob tier/rarity
        "weight": 5                            // Spawn probability weight
      },
      {
        "tier": "legendary",                   // No mobType = any mob type
        "weight": 2
      },
      {
        "mobType": "fish",
        "tier": "uncommon",
        "weight": 10
      }
    ]
  }
}
```

### Spawn Table Properties

#### mobType (optional)
- If specified: Only spawn this specific mob type
- If omitted: Spawn any available mob type
- Examples: `"fish"`, `"octopus"`, `"shark"`

#### tier (required)
Valid tiers:
- `"common"` - Basic mobs
- `"uncommon"` - Slightly stronger
- `"rare"` - Moderate difficulty
- `"epic"` - Challenging
- `"legendary"` - Very difficult
- `"mythic"` - Extreme difficulty
- `"ultra"` - Boss-tier (special spawning)
- `"super"` - Mega-boss (special spawning)
- `"unique"` - Ultra-rare boss (special spawning)

#### weight (required)
- Higher weight = more likely to spawn
- Relative to other entries in the table
- Example: weight 10 is twice as likely as weight 5

### Spawn Table Calculation

The system calculates spawn probability using weighted random selection:

```
Total Weight = sum of all weights in spawn table
Probability of Entry = Entry Weight / Total Weight
```

Example:
```json
"spawnTable": [
  { "tier": "common", "weight": 50 },      // 50% chance
  { "tier": "rare", "weight": 30 },        // 30% chance
  { "tier": "legendary", "weight": 20 }    // 20% chance
]
```

### Background Textures

Background textures should be:
- Placed in the `assets/` directory (and copied to `dist/`)
- Referenced relative to the dist folder (e.g., `"desert.svg"`)
- Tileable for seamless appearance
- 400x400 pixels is recommended (matches default)

Supported formats:
- SVG files (recommended) - scalable and small file size
- PNG/JPG images - for photographic/complex textures

## Example Biomes

### Example 1: Desert Biome
High-tier mobs with sandy background:

```json
{
  "type": "biome",
  "x": 8000,
  "y": 12000,
  "width": 3000,
  "height": 3000,
  "properties": {
    "biomeName": "desert",
    "backgroundTexture": "desert.svg",
    "spawnTable": [
      { "tier": "epic", "weight": 4 },
      { "tier": "legendary", "weight": 3 },
      { "tier": "mythic", "weight": 1 }
    ]
  }
}
```

### Example 2: Coral Reef (Fish-Only)
Underwater theme with only fish mobs:

```json
{
  "type": "biome",
  "x": 2000,
  "y": 8000,
  "width": 2500,
  "height": 2500,
  "properties": {
    "biomeName": "coral_reef",
    "backgroundTexture": "coral.svg",
    "spawnTable": [
      { "mobType": "fish", "tier": "common", "weight": 10 },
      { "mobType": "fish", "tier": "uncommon", "weight": 6 },
      { "mobType": "fish", "tier": "rare", "weight": 3 }
    ]
  }
}
```

### Example 3: Mixed Biome
Different mob types with different rarities:

```json
{
  "type": "biome",
  "x": 15000,
  "y": 5000,
  "width": 2000,
  "height": 2000,
  "properties": {
    "biomeName": "mixed_zone",
    "backgroundTexture": "mixed.svg",
    "spawnTable": [
      { "mobType": "fish", "tier": "uncommon", "weight": 5 },
      { "mobType": "octopus", "tier": "rare", "weight": 4 },
      { "tier": "legendary", "weight": 1 }
    ]
  }
}
```

## Biome-Only Mobs

You can configure mobs to **only spawn in biomes** by setting the `biomeOnly` property:

```typescript
// In src/mobs.ts
const BASE_MOB_CONFIGS = {
    kraken: {
        name: "Common Kraken",
        // ... other properties
        biomeOnly: true  // This mob ONLY spawns in biomes
    }
};
```

**Benefits**:
- Create exclusive mobs for special biomes
- Make certain mob types only appear in designated areas
- Enhance exploration and biome uniqueness
- Control mob distribution across the world

**See**: `BIOME_ONLY_MOBS_GUIDE.md` for complete documentation on this feature.

## Technical Implementation

### Server-Side (src/server.ts)
- `getBiomeAtPosition(x, y)` - Finds biome at position
- `selectSpawnFromBiomeTable(spawnTable)` - Weighted random selection
- `createEnemy()` - Modified to check for biomes and use their spawn tables
- Filters out biome-only mobs when spawning in regular zones

### Mob Configuration (src/mobs.ts)
- `MobStats.biomeOnly` - Property indicating if mob is biome-only
- `BaseMobConfig.biomeOnly` - Optional property for base mob configuration
- Biome-only mobs are excluded from regular zone spawning

### Client-Side (src/graphics.ts)
- `setBiomeTexture(biomeName, texture)` - Registers biome texture
- `getBiomeAtPosition(x, y)` - Client-side biome detection
- `drawScrollingBackground()` - Renders biome-specific backgrounds

### Client-Side Loading (src/game.ts)
- `loadBiomeTextures(mapData)` - Loads all biome textures when map data is received
- Supports both SVG and image formats
- Automatic texture caching to prevent duplicate loads

## Map Editor Support

The biome type is now available in the map editor's type selector. To add biomes:

1. Select "biome" from the element type dropdown
2. Draw the biome area on the map
3. Manually edit the generated JSON to add spawn table and background texture properties

## Testing Your Biome

1. Add the biome definition to your map JSON
2. Place the background texture file in `dist/` folder
3. Start the server and join the game
4. Navigate to the biome coordinates
5. Check console logs for:
   - `"Biome texture '<biomeName>' loaded successfully"`
   - Mob spawning should use the biome's spawn table

## Troubleshooting

### Background texture not loading
- Verify the texture file exists in the `dist/` folder
- Check browser console for load errors
- Ensure the file path in `backgroundTexture` is correct
- Try using an absolute path if relative path fails

### Mobs not spawning correctly
- Check spawn table is properly formatted JSON
- Verify mob types exist in `MOB_CONFIG`
- Ensure weights are positive numbers
- Check console for error messages

### Biome not rendering
- Verify biomeName is unique across all biomes
- Check biome coordinates are within world boundaries
- Ensure mapData is being sent to client correctly
- Check graphics console logs for biome detection

## Performance Notes

- Biome detection is performed per-tile during background rendering
- Large numbers of small biomes may impact performance
- Recommended: Use fewer, larger biomes rather than many small ones
- Background textures are cached and reused across tiles

## Future Enhancements

Potential improvements for the biome system:
- Biome transitions with gradient blending
- Time-based spawn variations (day/night cycles in biomes)
- Weather effects per biome
- Biome-specific sound/music
- Particle effects for biome ambiance
- Mob behavior modifications per biome

