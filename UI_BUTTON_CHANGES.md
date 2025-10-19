# UI Button Layout Changes

## Summary
Reorganized the game UI buttons according to the following requirements:
- Moved settings button to top left corner (visible on title screen)
- Added exit button next to settings button (visible only in-game)
- Added craft and inventory buttons to bottom left corner
- All buttons use game-icons.net icons and are sized at 32x32px
- Fixed crafting button to only trigger crafting (not inventory)

## Changes Made

### 1. Settings Button (Top Left, Always Visible)
- **Location**: Top left corner (20px from top and left)
- **Icon**: 'settings' icon from game-icons.net (gear icon)
- **Size**: 32x32px
- **Visibility**: Always visible (title screen and in-game)
- **Styling**: Semi-transparent black background with rounded corners

### 2. Exit Button (Top Left, Next to Settings)
- **Location**: Top left corner, to the right of settings button (10px gap)
- **Icon**: 'exit_button' icon from game-icons.net (X in circle)
- **Size**: 32x32px
- **Visibility**: Only visible during gameplay (hidden on title screen)
- **Action**: Reloads page to return to title screen
- **Styling**: Semi-transparent black background with rounded corners

### 3. Craft Button (Bottom Left, Above Inventory)
- **Location**: Bottom left corner, above inventory button (20px from left and bottom)
- **Icon**: 'craft' icon from game-icons.net
- **Size**: 32x32px
- **Hotkey**: R (same as keyboard shortcut)
- **Tooltip**: "Craft (R)"
- **Styling**: Semi-transparent black background with rounded corners
- **Bug Fix**: Now properly triggers only crafting panel (not inventory)

### 4. Inventory Button (Bottom Left)
- **Location**: Bottom left corner, below craft button (20px from left and bottom)
- **Icon**: 'inventory' icon from game-icons.net (stacked layers icon)
- **Size**: 32x32px
- **Hotkey**: I (same as keyboard shortcut)
- **Tooltip**: "Inventory (I)"
- **Styling**: Semi-transparent black background with rounded corners

## Technical Implementation

### Files Modified
- `/src/title_screen.ts`: Updated button layout and event handlers

### Key Changes
1. **exitButtonContainer**: Now contains both settings and exit buttons side by side
   - Settings button is always visible (title screen + in-game)
   - Exit button is only visible during gameplay
2. **bottomLeftButtons**: New container element for craft and inventory buttons
3. **Event Listeners**: 
   - Settings button opens the settings menu
   - Exit button reloads the page to return to title screen
   - Craft button dispatches crafting keydown event (with `preventDefault()` and `stopPropagation()`)
   - Inventory button dispatches inventory keydown event (with `preventDefault()` and `stopPropagation()`)
4. **Visibility Management**: 
   - `showExitButton()` shows exit button and bottom left buttons (keeps settings visible)
   - `hideExitButton()` hides exit button and bottom left buttons (keeps settings visible)
   - Container uses `display: flex` with 10px gap for proper layout
5. **Bug Fixes**:
   - Added event propagation prevention to avoid craft button triggering inventory
   - Added setTimeout to ensure DOM is ready before attaching button listeners
   - Properly reads control keys from localStorage

### Icon Formatting
All icons are properly sized to 32x32px using SVG attribute replacement:
```typescript
const formattedSettingsIcon = settingsIcon.replace('viewBox="0 0 512 512"', 'viewBox="0 0 512 512" width="32" height="32"');
const formattedCraftIcon = craftIcon.replace('width="512px" height="512px"', 'width="32" height="32"');
const formattedInventoryIcon = inventoryIcon.replace('viewBox="0 0 512 512"', 'viewBox="0 0 512 512" width="32" height="32"');
```

## Visual Layout

### Title Screen
```
┌─────────────────────────────────────┐
│ [⚙️] Settings                        │  ← Top left (32x32) - Always visible
│                                     │
│          TITLE SCREEN               │
│                                     │
│                                     │
│                                     │
│                                     │
│                                     │
│                                     │
└─────────────────────────────────────┘
```

### In-Game
```
┌─────────────────────────────────────┐
│ [⚙️] Settings [❌] Exit             │  ← Top left (32x32 each, 10px gap)
│                                     │
│            GAMEPLAY                 │
│                                     │
│                                     │
│                                     │
│                                     │
│ [🔨] Craft                          │  ← Bottom left (32x32)
│ [📦] Inventory                      │  ← Bottom left (32x32)
└─────────────────────────────────────┘
```

## User Experience
- All buttons are easily accessible in corners of the screen
- **Settings button** always visible in top left for quick access to game configuration (both title screen and in-game)
- **Exit button** appears next to settings when in-game, allowing quick return to title screen
- **Craft and Inventory** buttons in bottom left for quick access to gameplay features
- Tooltips show keyboard shortcuts for power users
- Clicking buttons triggers same action as keyboard shortcuts
- Consistent 32x32px size and styling across all buttons
- Event propagation properly handled to prevent button conflicts

## Bug Fixes Included
1. **Exit Button Not Appearing**: Fixed by keeping `exitButtonContainer` always visible with `display: flex`, only hiding the exit button element itself when on title screen
2. **Settings Not on Title Screen**: Settings button now always visible, container no longer hidden
3. **Craft Button Opening Inventory**: Fixed by adding `preventDefault()` and `stopPropagation()` to event handlers, preventing event bubbling that was causing both panels to open

