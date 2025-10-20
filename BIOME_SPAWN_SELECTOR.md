# Biome Spawn Selector Feature

## Overview
Added a biome selector to the title screen that allows players to choose which biome they want to spawn in when joining the game.

## Changes Made

### 1. Title Screen UI (`src/title_screen.ts`)

#### Added Biome Selector Dropdown
- Added a dropdown selector below the name input with the following options:
  - Default (Common Spawn)
  - Desert
  - Ocean
  - Swamp
  - Ant Hell

#### CSS Styling
- Added `.biome-selector-container` class for the dropdown container
- Added `.biome-selector` class for the dropdown element
- Styled with white background, smooth hover effects, and responsive design

#### Persistence
- Extended `setupNameInputPersistence()` method to handle biome selection
- Selected biome is saved to `localStorage` with key `'spawnBiome'`
- Previously selected biome is restored when the page loads
- Changes are logged to console for debugging

### 2. Client-Side Authentication (`src/game.ts`)

#### Updated `authenticate()` Method
- Added `spawnBiome` parameter to credentials object
- Reads selected biome from `localStorage` (defaults to `'default'`)
- Sends biome selection to server during authentication

### 3. Server-Side Spawn Logic (`src/server.ts`)

#### New Helper Function: `getSpawnPositionInBiome()`
- Finds all valid biome areas with the specified name
- Filters out biomes with zero width/height
- Selects a random biome if multiple exist
- Generates a random spawn position within the biome bounds
- Applies 50-pixel padding from biome edges for safety
- Returns null if no valid biomes are found

#### Updated `authenticate` Event Handler
- Now accepts `spawnBiome` parameter in credentials
- Determines spawn position based on selected biome:
  - **If biome is selected**: Uses `getSpawnPositionInBiome()` to spawn in that biome
  - **If 'default' is selected**: Uses common spawn zones from the map
  - **If biome not found**: Falls back to default spawn logic
- Logs spawn location and biome selection for debugging

## Available Biomes

Based on the current map (`map_current.json`), the following biomes are available:

1. **Desert** - Legendary and Mythic tier enemies
2. **Ocean** - Epic tier enemies (underwater biome)
3. **Swamp** - Common tier enemies (beginner-friendly)
4. **Ant Hell** - Mythic/Legendary/Epic tier enemies (high difficulty)

## User Experience

1. Player opens the game and sees the title screen
2. Player enters their name in the name input field
3. **NEW**: Player selects their desired spawn biome from the dropdown
4. Player clicks "Ready" to join the game
5. Player spawns in the selected biome (or default spawn if "Default" was selected)
6. Selection is remembered for next time they play

## Technical Details

### Data Flow
```
Title Screen (UI) 
  ↓ localStorage.setItem('spawnBiome', value)
Game.authenticate() 
  ↓ socket.emit('authenticate', { ..., spawnBiome })
Server authenticate handler 
  ↓ getSpawnPositionInBiome(biomeName)
Player spawns at biome coordinates
```

### Spawn Position Calculation
- Biome coordinates from map are multiplied by `SCALE_FACTOR`
- 50-pixel padding prevents spawning too close to biome edges
- Random position within biome bounds ensures variety
- Multiple biome areas with same name are all considered

### Fallback Behavior
- If selected biome doesn't exist → Uses default common spawn
- If no common spawn zones exist → Falls back to center of world
- If biome has zero size → Ignored, tries next valid biome

## Testing

To test the feature:
1. Start the game server
2. Open the game in a browser
3. Try selecting different biomes from the dropdown
4. Click "Ready" and verify you spawn in the correct biome
5. Check browser console and server logs for spawn location messages
6. Reload the page and verify the biome selection is remembered

## Future Enhancements

Possible improvements:
- Add biome descriptions/difficulty indicators in the dropdown
- Show biome preview images
- Restrict certain biomes based on player level
- Add biome-specific spawn effects or animations
- Allow respawning in the same biome after death (optional)

