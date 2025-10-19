# Changelog System Documentation

## Overview
The changelog system provides a user-friendly dropdown menu that displays version history and updates directly in the game interface.

## Features

### Visual Design
- **Dropdown Menu**: Appears below the changelog button (600px wide, max 500px height)
- **Bullet Points**: Clean green bullets for each change entry
- **Custom Scrollbar**: Green theme matching the changelog button
- **Close Button**: Red X button in top-right corner
- **Dark Theme**: Semi-transparent black background for readability

### User Interaction
- Click the changelog button to toggle the menu
- Press ESC key to close the menu
- Click the close button (X) to dismiss
- Scroll through version history
- Menu automatically closes when clicked outside

## File Structure

### `/src/changelog.ts`
Main changelog file containing:
- `ChangelogEntry` interface: Defines the structure of each version entry
- `CHANGELOG` array: Contains all version entries
- `ChangelogManager` class: Manages the changelog UI and interactions

### Integration
- Imported in `/src/title_screen.ts`
- Instantiated as `changelogManager` in the TitleScreen class
- Linked to the changelog button click event

## Adding New Changelog Entries

### Step 1: Open changelog.ts
```bash
open src/changelog.ts
```

### Step 2: Add Your Entry
Add a new entry at the **top** of the `CHANGELOG` array (newest first):

```typescript
{
    version: '1.3.0',
    date: '2025-10-20',
    changes: [
        { type: 'added', description: 'New boss enemy type' },
        { type: 'added', description: 'Achievement system' },
        { type: 'changed', description: 'Increased player base health by 20%' },
        { type: 'fixed', description: 'Inventory duplication bug' },
        { type: 'removed', description: 'Legacy login system' },
    ]
},
```

### Step 3: Rebuild
```bash
npm run build
```

## Data Structure

### ChangelogEntry Interface
```typescript
interface ChangelogEntry {
    date: string;         // Release date (e.g., "October 19, 2025")
    changes: string[];    // Array of change descriptions
}
```

### Example Entry
```typescript
{
    date: 'October 19, 2025',
    changes: [
        'Changelog button with dropdown menu',
        'Craft button no longer opens inventory',
        'Button colors updated for better visibility',
    ]
}
```

## Best Practices

### Date Format
Use a readable date format like "October 19, 2025" or "October 19th, 2025" for consistency.

### Writing Descriptions
- Keep descriptions concise and clear
- Be specific about what changed
- Use complete sentences or clear phrases
- Avoid technical jargon when possible

### Good Examples
✅ "New boss enemy in desert zone"
✅ "Inventory items no longer disappear on server transfer"
✅ "Player movement speed increased by 20%"
✅ "Changelog button with dropdown menu"

### Bad Examples
❌ "Fixed bugs"
❌ "Updated stuff"
❌ "Backend API endpoints refactored"

## Styling Customization

### Colors
Change bullet color in `changelog.ts` under the style section:
```typescript
.changelog-change::before {
    content: '•';
    color: #4CAF50;  // Bullet color (green)
}
```

### Panel Size
Adjust panel dimensions:
```typescript
width: 600px;           // Panel width
max-height: 500px;      // Maximum height before scrolling
```

### Position
Adjust panel position:
```typescript
top: 72px;    // Distance from top (below button)
left: 20px;   // Distance from left (aligned with button)
```

## Current Changelog

### October 19, 2025
- Changelog button with dropdown menu
- Craft and Inventory buttons at bottom left corner
- Settings button moved to top left corner
- Button colors updated for better visibility
- Craft button no longer opens inventory
- Button hover areas now match visual size

### October 15, 2025
- Tutorial system for new players
- Cross-server teleportation
- Improved inventory UI
- Player collision detection issues fixed

### October 1, 2025
- Initial release
- Player movement and controls
- Basic enemy types
- Inventory system
- Crafting system

## Troubleshooting

### Menu Not Showing
1. Check browser console for errors
2. Verify `ChangelogManager` is instantiated in `title_screen.ts`
3. Ensure changelog button click event is properly bound
4. Rebuild the project: `npm run build`

### Styles Not Applied
1. Check if styles are injected in `ChangelogManager` constructor
2. Clear browser cache
3. Verify CSS in `changelog.ts` is valid

### Wrong Data Showing
1. Check `CHANGELOG` array order (newest first)
2. Verify entry format matches `ChangelogEntry` interface
3. Rebuild after making changes

## Future Enhancements

Potential improvements:
- [ ] Search/filter functionality
- [ ] Collapsible version sections
- [ ] Direct links to related documentation
- [ ] "What's New" badge for recent updates
- [ ] Export changelog as text/PDF
- [ ] Version comparison view

