# UI Button Layout Changes

## Summary
Reorganized the game UI buttons according to the following requirements:
- Moved settings button to top left corner (always visible)
- Added changelog button between settings and exit (always visible)
- Added exit button after changelog (visible only in-game)
- Added craft and inventory buttons to bottom left corner
- All buttons use game-icons.net icons and are sized at 32x32px
- Color-coded backgrounds for easy identification
- Fixed crafting button to only trigger crafting (not inventory)

## Changes Made

### 1. Settings Button (Top Left, Always Visible)
- **Location**: Top left corner (20px from top and left)
- **Icon**: 'settings' icon from game-icons.net (gear icon)
- **Size**: 32x32px
- **Visibility**: Always visible (title screen and in-game)
- **Styling**: Semi-transparent black background with rounded corners

### 2. Changelog Button (Top Left, Next to Settings)
- **Location**: Top left corner, between settings and exit buttons (10px gap on each side)
- **Icon**: 'changelog' icon from game-icons.net (document/list icon)
- **Size**: 32x32px
- **Visibility**: Always visible (title screen and in-game)
- **Action**: Opens changelog dropdown menu below the button (600px wide, max 500px height)
- **Styling**: Green background (#4CAF50) with rounded corners
- **Menu Features**:
  - Scrollable list of updates grouped by date
  - Clean bullet-point format with green bullets
  - Close button and ESC key support
  - Custom green scrollbar matching button theme

### 3. Exit Button (Top Left, After Changelog)
- **Location**: Top left corner, to the right of changelog button (10px gap)
- **Icon**: 'exit_button' icon from game-icons.net (X in circle)
- **Size**: 32x32px
- **Visibility**: Only visible during gameplay (hidden on title screen)
- **Action**: Reloads page to return to title screen
- **Styling**: Red background (#ff0000) with rounded corners

### 4. Craft Button (Bottom Left, Above Inventory)
- **Location**: Bottom left corner, above inventory button (20px from left and bottom)
- **Icon**: 'craft' icon from game-icons.net
- **Size**: 32x32px
- **Hotkey**: R (same as keyboard shortcut)
- **Tooltip**: "Craft (R)"
- **Styling**: Orange background (#ff9d00) with rounded corners
- **Bug Fix**: Now properly triggers only crafting panel (not inventory)

### 5. Inventory Button (Bottom Left)
- **Location**: Bottom left corner, below craft button (20px from left and bottom)
- **Icon**: 'inventory' icon from game-icons.net (stacked layers icon)
- **Size**: 32x32px
- **Hotkey**: I (same as keyboard shortcut)
- **Tooltip**: "Inventory (I)"
- **Styling**: Blue background (#00b3ff) with rounded corners

## Technical Implementation

### Files Modified
- `/src/title_screen.ts`: Updated button layout and event handlers
- `/src/game-icons-net-icons.ts`: Added changelog icon
- `/src/changelog.ts`: New file containing changelog data and manager class

### Key Changes
1. **exitButtonContainer**: Now contains settings, changelog, and exit buttons in a row
   - Settings button is always visible (title screen + in-game)
   - Changelog button is always visible (title screen + in-game)
   - Exit button is only visible during gameplay
2. **bottomLeftButtons**: New container element for craft and inventory buttons
3. **ChangelogManager**: New manager class for changelog functionality
   - Manages changelog dropdown panel
   - Handles showing/hiding with toggle functionality
   - Reads from structured changelog data
   - Automatically formats entries with color-coded badges
4. **Event Listeners**: 
   - Settings button opens the settings menu
   - Changelog button toggles changelog dropdown menu
   - Exit button reloads the page to return to title screen
   - Craft button dispatches crafting keydown event (with `preventDefault()` and `stopPropagation()`)
   - Inventory button dispatches inventory keydown event (with `preventDefault()` and `stopPropagation()`)
5. **Visibility Management**: 
   - `showExitButton()` shows exit button and bottom left buttons (keeps settings visible)
   - `hideExitButton()` hides exit button and bottom left buttons (keeps settings visible)
   - Container uses `display: flex` with 10px gap for proper layout
6. **Bug Fixes**:
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
│ [⚙️] Settings [📋] Changelog        │  ← Top left (32x32 each, 10px gap) - Always visible
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
│ [⚙️] Settings [📋] Changelog [❌] Exit │  ← Top left (32x32 each, 10px gap)
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

## Changelog System

### Changelog Data Structure
The changelog is stored in `/src/changelog.ts` with the following structure:
```typescript
interface ChangelogEntry {
    date: string;
    changes: string[];
}
```

### Adding New Changelog Entries
To add a new entry to the changelog, simply add a new entry to the `CHANGELOG` array in `changelog.ts`:
```typescript
{
    date: 'October 20, 2025',
    changes: [
        'Your new feature',
        'Your changes',
        'Your bug fixes',
    ]
}
```

## User Experience
- All buttons are easily accessible in corners of the screen
- **Settings button** always visible in top left for quick access to game configuration (both title screen and in-game)
- **Changelog button** always visible next to settings, opens dropdown menu showing update history
- **Exit button** appears after changelog when in-game, allowing quick return to title screen
- **Craft and Inventory** buttons in bottom left for quick access to gameplay features
- Tooltips show keyboard shortcuts for power users (where applicable)
- Clicking buttons triggers same action as keyboard shortcuts
- Color-coded buttons for easy identification:
  - Gray (#b3b3b3) for Settings
  - Green (#4CAF50) for Changelog
  - Red (#ff0000) for Exit
  - Orange (#ff9d00) for Craft
  - Blue (#00b3ff) for Inventory
- Consistent 42x42px size (32px icon + 5px padding) with `box-sizing: border-box` for precise hover areas
- Event propagation properly handled to prevent button conflicts

## Bug Fixes Included
1. **Exit Button Not Appearing**: Fixed by keeping `exitButtonContainer` always visible with `display: flex`, only hiding the exit button element itself when on title screen
2. **Settings Not on Title Screen**: Settings button now always visible, container no longer hidden
3. **Craft Button Opening Inventory**: Fixed by adding `preventDefault()` and `stopPropagation()` to event handlers, preventing event bubbling that was causing both panels to open

