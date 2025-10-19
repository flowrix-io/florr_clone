# Map Editor - Biome Creation Guide

## Overview

The map editor now supports creating biomes with custom spawn tables and background textures. This guide explains how to use the biome tool in the map editor.

## Opening the Map Editor

1. Open `MapEditor.html` in your web browser
2. The editor will display a canvas showing the game world

## Creating a Biome

### Step 1: Select the Biome Tool

1. Click the **"Biome"** button in the Tools section
2. The properties panel will display biome-specific options

### Step 2: Configure Biome Properties

In the Properties panel, you'll see three fields:

#### Biome Name
- **Purpose**: Unique identifier for the biome
- **Format**: Use lowercase with underscores (e.g., `coral_reef`, `desert_zone`)
- **Example**: `deep_ocean`

#### Texture File
- **Purpose**: Path to the background texture
- **Format**: Relative path from dist folder (e.g., `coral.svg`, `desert.png`)
- **Example**: `land.svg` (uses default texture)

#### Spawn Table Editor
- **Purpose**: Define which mobs spawn in this biome
- **Format**: CSV format - `mobType,tier,weight` (one per line)
- **mobType**: Optional - `fish`, `octopus`, `shark`, or leave empty for any mob
- **tier**: Required - `common`, `uncommon`, `rare`, `epic`, `legendary`, `mythic`
- **weight**: Required - Higher numbers = more common spawns

### Step 3: Create the Spawn Table

Enter spawn entries in the Spawn Table Editor textarea, one per line:

**Format**: `mobType,tier,weight`

**Examples**:
```
fish,rare,5
octopus,epic,3
,legendary,2
```

**What this means**:
- Line 1: Fish mobs, rare tier, weight 5 (most common)
- Line 2: Octopus mobs, epic tier, weight 3 (medium)
- Line 3: Any mob type, legendary tier, weight 2 (less common)

**Probability Calculation**:
Total weight = 5 + 3 + 2 = 10
- Fish/rare: 5/10 = 50% chance
- Octopus/epic: 3/10 = 30% chance
- Any/legendary: 2/10 = 20% chance

### Step 4: Draw the Biome

1. Click and drag on the canvas to create the biome area
2. The biome will appear as a **purple rectangle**
3. Release the mouse to finalize the size

### Step 5: Verify the Biome

1. Check the **Elements** list on the left
2. Your biome should appear with a purple border
3. Hover over it to see:
   - Biome name
   - Background texture
   - Number of spawn table entries

## Example Biomes

### Example 1: Coral Reef (Fish Only)
**Biome Name**: `coral_reef`  
**Texture File**: `coral.svg`  
**Spawn Table**:
```
fish,common,10
fish,uncommon,7
fish,rare,3
```

### Example 2: Octopus Den
**Biome Name**: `octopus_den`  
**Texture File**: `land.svg`  
**Spawn Table**:
```
octopus,rare,5
octopus,epic,3
octopus,legendary,1
```

### Example 3: Mixed High-Level Zone
**Biome Name**: `danger_zone`  
**Texture File**: `land.svg`  
**Spawn Table**:
```
,epic,5
,legendary,4
,mythic,1
```
(Note: Empty mobType means any mob can spawn)

### Example 4: Peaceful Waters
**Biome Name**: `safe_waters`  
**Texture File**: `land.svg`  
**Spawn Table**:
```
fish,common,15
,common,10
fish,uncommon,5
```

## Editing Existing Biomes

1. Click the **Select** tool
2. Click on the biome element in the **Elements** list
3. The properties panel will populate with the biome's current settings
4. Modify any properties
5. The changes are saved automatically

## Validating Your Map

1. Click the **Validate Map** button
2. The validator will check:
   - ✅ Biome has a name
   - ✅ Biome has a background texture
   - ✅ Spawn table is not empty
   - ✅ All tier names are valid
   - ✅ All weights are positive numbers
   - ✅ Biome dimensions are valid

## Common Issues and Solutions

### Issue: Spawn table not parsing correctly
**Solution**: Check your CSV format
- Use commas to separate values
- One entry per line
- No extra spaces (they'll be trimmed automatically)

### Issue: Biome not showing in game
**Solution**: 
1. Verify the biome is in the exported map JSON
2. Check that background texture file exists in `dist/` folder
3. Ensure biome coordinates are within world boundaries

### Issue: Wrong mobs spawning
**Solution**:
1. Check mobType spelling: must be `fish`, `octopus`, or `shark`
2. Verify tier names: must be exact (lowercase)
3. Check weight calculations (higher = more common)

### Issue: Background texture not loading
**Solution**:
1. Ensure texture file is in `dist/` folder
2. Use correct path (relative to dist, e.g., `coral.svg` not `assets/coral.svg`)
3. Try using `land.svg` as a test (this always exists)

## Spawn Table Tips

### Using Weights Effectively

**Equal Distribution**:
```
fish,common,1
octopus,common,1
shark,common,1
```
Result: 33.3% each

**Biased Distribution**:
```
fish,common,10
octopus,rare,2
shark,epic,1
```
Result: 77% fish, 15% octopus, 8% shark

**Specific Mob Only**:
```
fish,rare,1
```
Result: 100% rare fish (no variation)

### Tier Progression

**Low-Level Area**:
```
,common,10
,uncommon,3
,rare,1
```

**Mid-Level Area**:
```
,uncommon,5
,rare,4
,epic,1
```

**High-Level Area**:
```
,epic,5
,legendary,3
,mythic,1
```

**Boss Area**:
```
,legendary,5
,mythic,5
```

## Exporting Your Map

1. Click **Export Map** button
2. A JSON file will download
3. Place this file in your server configuration
4. Ensure all texture files referenced in biomes exist in `dist/` folder

## Map Legend

When working with biomes, you'll see:
- **Purple rectangles** = Biomes on canvas
- **Purple left border** = Biomes in element list
- Hover over biomes in element list to see spawn details

## Testing Your Biomes

1. Export the map
2. Update your server to use the new map
3. Start the server
4. Navigate to the biome coordinates in-game
5. Observe mob spawns (should match your spawn table weights)
6. Check if background texture loads correctly

## Advanced Tips

### Multiple Biomes, Same Texture
You can reuse textures across biomes:
- **Biome 1**: `coral_reef` → `coral.svg`
- **Biome 2**: `coral_shallow` → `coral.svg`
- Different spawn tables, same visual theme

### Layering Spawn Logic
Biomes **override** normal spawn zones, so:
- Mobs in biome areas only use biome spawn table
- Mobs outside biomes use normal spawn zone logic
- Use this to create special areas within larger zones

### Size Considerations
- **Large biomes** (3000x3000+): Better performance, clear distinct areas
- **Small biomes** (500x500): More variety, but may impact performance

### Spawn Table Balance
- Total weight doesn't matter (only ratios)
- Weight 1,2,3 same as 10,20,30
- Use numbers that are easy to calculate percentages

## Keyboard Shortcuts

- **Select Tool**: Click biomes to edit them
- **Delete Tool**: Click biomes to remove them
- **Mouse Drag**: Move selected biomes (in Select mode)

## Troubleshooting

### Validation Errors

**Error: "Biome X is missing biomeName property"**
- Enter a name in the Biome Name field before creating

**Error: "Spawn table entry X has invalid tier"**
- Check spelling of tier names (must be lowercase)
- Valid: common, uncommon, rare, epic, legendary, mythic, ultra, super, unique

**Error: "Spawn table entry X has invalid weight"**
- Weight must be a positive number
- Cannot be 0 or negative

### Warnings

**Warning: "Biome has no background texture specified"**
- Enter a texture filename (e.g., `land.svg`)
- This won't prevent the biome from working

**Warning: "Biome has empty spawn table"**
- Add at least one spawn entry
- Default will be used if empty (common mobs)

## Quick Reference

### CSV Format
```
mobType,tier,weight
```

### Mob Types
- `fish` - Fish mob
- `octopus` - Octopus mob  
- `shark` - Shark mob
- (empty) - Any mob type

### Valid Tiers
- `common` - Most basic
- `uncommon` - Slightly tougher
- `rare` - Moderate challenge
- `epic` - Difficult
- `legendary` - Very difficult
- `mythic` - Extremely difficult
- `ultra` - Boss tier
- `super` - Mega boss
- `unique` - Ultra rare boss

### Weight Examples
- `1` = Rare
- `5` = Common
- `10` = Very common
- `20` = Extremely common

Remember: Only the ratio between weights matters, not the absolute values!

