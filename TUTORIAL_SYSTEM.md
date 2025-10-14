# Tutorial System Documentation

## Overview

A comprehensive tutorial system has been added to florr.io clone to guide new users through the game's core mechanics. The tutorial automatically starts when a player first enters the game and can be skipped at any time.

## Features

### Tutorial Steps

The tutorial guides players through these key concepts:

1. **Welcome** - Introduction to the game
2. **Movement** - How to move using W/A/S/D or Arrow Keys
3. **Extending Petals** - How to use SPACE to extend petals for combat
4. **Loadout Bar** - Understanding the loadout system and key bindings (1-9, 0)
5. **Inventory** - Opening inventory with 'I' key
6. **Equipping Petals** - Drag and drop petals from inventory to loadout
7. **Crafting Introduction** - Opening crafting menu with 'R' key
8. **Crafting Process** - How to combine 5 items to upgrade rarity
9. **Combat Tips** - Strategy and petal mechanics
10. **Additional Controls** - Complete control reference
11. **Tutorial Complete** - Completion message

### Auto-Detection

The tutorial intelligently detects when players complete certain actions:

- **Movement**: Detects when player presses movement keys
- **Petal Extension**: Detects when player holds SPACE
- **Inventory Open**: Detects when player presses 'I'
- **Crafting Open**: Detects when player presses 'R'
- **Item Equipped**: Detects when player drags an item to loadout

### Visual Highlights

The tutorial system includes:
- **Dark overlay** that focuses attention on the tutorial box
- **Element highlighting** with pulsing animation for important UI elements
- **Progress indicators** showing current step and total steps
- **Smooth animations** for professional feel

### User Controls

Players can:
- **Skip Tutorial**: Available on most steps with confirmation dialog
- **Auto-Advance**: Tutorial automatically advances when player completes required actions
- **Manual Next**: Click "Next" button on informational steps
- **Reset Tutorial**: Available in Settings > Graphics tab

## Technical Implementation

### File Structure

- **`src/tutorial.ts`**: Main tutorial system class
- **Integration**: Added to `src/game.ts` constructor
- **Settings**: Reset option added to `src/title_screen.ts`

### Tutorial Class API

```typescript
class Tutorial {
    start(): void                 // Start the tutorial
    skip(): void                  // Skip the tutorial
    complete(): void              // Complete the tutorial
    reset(): void                 // Reset tutorial progress
    restart(): void               // Restart tutorial from beginning
    isRunning(): boolean          // Check if tutorial is active
}
```

### localStorage Keys

The tutorial system uses these localStorage keys:
- `tutorial_completed`: Set to 'true' when tutorial is completed
- `tutorial_step`: Stores current step index for resume capability

### Step Configuration

Each tutorial step has:
```typescript
interface TutorialStep {
    id: string;                   // Unique identifier
    title: string;                // Step title
    description: string;          // HTML-formatted instructions
    highlightElement?: string;    // CSS selector to highlight
    position: 'top' | 'bottom' | 'left' | 'right' | 'center';
    condition?: () => boolean;    // Optional auto-advance condition
    skipButton?: boolean;         // Show/hide skip button
}
```

## Usage

### For Players

1. **First Time**: Tutorial automatically starts after authentication
2. **Skip**: Click "Skip Tutorial" button at any time
3. **Reset**: Go to Settings > Graphics > Reset Tutorial

### For Developers

To modify tutorial steps, edit the `steps` array in `src/tutorial.ts`:

```typescript
private readonly steps: TutorialStep[] = [
    {
        id: 'welcome',
        title: '🌸 Welcome to florr.io!',
        description: 'Let\'s learn the basics!',
        position: 'center',
        skipButton: true
    },
    // Add more steps...
];
```

To integrate into other systems:

```typescript
import { Tutorial } from './tutorial';

// Create instance
const tutorial = new Tutorial();

// Start tutorial
tutorial.start();

// Check if running
if (tutorial.isRunning()) {
    // Tutorial is active
}
```

## Styling

The tutorial uses custom CSS animations:
- **slideIn**: Smooth entry animation
- **pulse**: Highlighting animation for UI elements
- **Gradient background**: Purple gradient for professional look

Colors:
- Primary: `#667eea` to `#764ba2` (gradient)
- Highlight: Yellow pulse effect
- Text: White on dark background

## Best Practices

### Adding New Steps

1. Add step to `steps` array
2. Define clear, concise instructions
3. Use HTML for formatting (bold, line breaks, etc.)
4. Add auto-detection if action-based
5. Test skip and next functionality

### Event Listeners

The tutorial sets up listeners for:
- Keyboard events (movement, hotkeys)
- DOM mutations (inventory/crafting panels)
- Loadout changes

These are automatically cleaned up when tutorial completes.

## Future Enhancements

Potential improvements:
- Animated arrows pointing to UI elements
- In-game tooltips system
- Progressive unlocking of features
- Achievement system integration
- Video demonstrations
- Interactive practice mode

## Troubleshooting

### Tutorial Won't Start

Check:
1. `localStorage.getItem('tutorial_completed')` should not be 'true'
2. Authentication completed successfully
3. Game loaded without errors

### Tutorial Won't Advance

Check:
1. Condition function returning correct boolean
2. Event listeners properly registered
3. No JavaScript console errors

### Reset Not Working

Solution:
1. Clear localStorage: `localStorage.clear()`
2. Reload page
3. Or use Settings > Graphics > Reset Tutorial

## Example Usage

```typescript
// In game.ts
import { Tutorial } from './tutorial';

class Game {
    private tutorial: Tutorial;
    
    constructor() {
        this.tutorial = new Tutorial();
    }
    
    private authenticate() {
        this.socket.on('authenticated', (response) => {
            if (response.success) {
                // Start tutorial after short delay
                setTimeout(() => {
                    this.tutorial.start();
                }, 1000);
            }
        });
    }
}
```

## Testing

To test the tutorial:
1. Clear localStorage: `localStorage.clear()`
2. Reload the game
3. Complete authentication
4. Tutorial should start automatically
5. Test each step's auto-advance
6. Test skip functionality
7. Verify reset works from settings

---

**Note**: The tutorial system is designed to be non-intrusive. Players can skip it at any time, and it only shows once per browser (unless reset).

