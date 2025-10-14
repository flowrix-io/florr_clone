# Tutorial System - User Guide

## 🎮 What is it?

An interactive, step-by-step tutorial that teaches new players how to play florr.io. It automatically appears the first time someone plays the game!

## ✨ Features

### 🎯 Smart Auto-Detection
The tutorial watches what you do and automatically advances when you:
- Move your character
- Extend your petals
- Open the inventory
- Open crafting
- Equip an item

### 🎨 Beautiful UI
- Gorgeous purple gradient design
- Smooth animations
- Pulsing highlights on important UI elements
- Progress indicator showing which step you're on

### ⚡ User-Friendly
- Can be skipped at any time
- Clear, easy-to-follow instructions
- Visual guides pointing to important areas
- Can be reset from settings

## 📖 What Players Learn

### Step 1: Welcome
A friendly greeting introducing the tutorial

### Step 2: Movement Controls
- Use W/A/S/D or Arrow Keys
- Tutorial waits until you try moving!

### Step 3: Petal Extension
- Hold SPACE to extend petals
- Learn that extended petals deal more damage
- Tutorial detects when you hold space

### Step 4: Loadout Bar
- Shows the bar at bottom of screen
- Explains the number key bindings (1-9, 0)
- Highlights the loadout bar with pulsing animation

### Step 5: Opening Inventory
- Press I to open inventory
- Tutorial waits until you open it!

### Step 6: Equipping Items
- Learn drag-and-drop mechanics
- Move items from inventory to loadout
- Tutorial detects when you equip something

### Step 7: Crafting Menu
- Press R to open crafting
- Introduction to the upgrade system
- Tutorial waits for you to open it

### Step 8: Crafting Process
- Detailed crafting instructions
- Explains 5-to-1 upgrade system
- Shows success chance mechanics
- Highlights the crafting panel

### Step 9: Combat Strategy
- Tips on petal health and damage
- Strategic advice for loadout building
- Offensive vs defensive balance

### Step 10: All Controls
Complete reference:
- C - Toggle mouse/keyboard controls
- H - Toggle hitboxes
- +/- - Zoom controls
- Enter - Chat
- ESC - Exit to menu

### Step 11: Completion
Congratulations message and final encouragement!

## 🎨 Visual Design

### Tutorial Box Appearance
```
┌─────────────────────────────────────────┐
│  🌸 Welcome to florr.io!                │
│                                         │
│  Let's learn the basics! You'll learn  │
│  how to move, use petals, equip items, │
│  and craft upgrades.                    │
│                                         │
│  [Skip Tutorial]  [Next]        1 / 11 │
│                                         │
│  ● ○ ○ ○ ○ ○ ○ ○ ○ ○ ○  (progress)   │
└─────────────────────────────────────────┘
```

### Colors
- **Background**: Purple gradient (#667eea → #764ba2)
- **Text**: White
- **Buttons**: White with purple text
- **Skip Button**: Semi-transparent white
- **Highlights**: Yellow pulsing glow

### Positioning
The tutorial box intelligently positions itself:
- **Center**: For general information
- **Top**: When highlighting bottom elements (loadout bar)
- **Left**: When highlighting right panels (crafting)
- **Bottom**: When highlighting top elements

## 🔧 For Server Administrators

### Configuration
The tutorial is stored in `src/tutorial.ts`. You can customize:

1. **Step content**: Edit the `steps` array
2. **Timing**: Adjust the auto-start delay (default: 1000ms)
3. **Colors**: Modify the CSS in `createTutorialUI()`
4. **Conditions**: Change auto-advance triggers

### Testing the Tutorial

```bash
# Open browser console
localStorage.clear()  # Reset everything
location.reload()     # Reload page
# Tutorial will start automatically
```

### Disable Tutorial (Optional)

If you want to disable the tutorial system:

```typescript
// In src/game.ts, comment out:
// setTimeout(() => {
//     this.tutorial.start();
// }, 1000);
```

## 🎯 Success Metrics

The tutorial tracks completion using localStorage:
- `tutorial_completed`: 'true' when finished
- `tutorial_step`: Current step index

You could extend this to:
- Track which steps users skip
- Measure completion rates
- Identify confusing steps

## 💡 Tips for Players

### If You Skip the Tutorial
Don't worry! You can:
1. Access controls in the Settings menu
2. Reset the tutorial from Settings > Graphics
3. Experiment - the game is designed to be intuitive

### If You Get Stuck
- Press ESC to see all controls
- Try moving around and pressing keys
- The tutorial auto-advances when you do the action
- You can always skip and explore on your own

## 🔄 Reset Instructions

### For Players
1. Press ESC to exit to menu
2. Click "Settings"
3. Go to "Graphics" tab
4. Click "Reset Tutorial"
5. Confirm
6. Start a new game

### For Developers
```javascript
// In browser console:
localStorage.removeItem('tutorial_completed');
localStorage.removeItem('tutorial_step');
location.reload();
```

## 📱 Mobile Support

The tutorial is designed for desktop but should work on mobile:
- Touch controls for drag-and-drop
- Responsive positioning
- Clear text sizing
- Easy-to-tap buttons

## 🎉 Example Flow

```
1. Player logs in → Wait 1 second
2. "Welcome!" appears → Player clicks Next
3. "Use WASD" appears → Player presses W
4. Auto-advances to next step!
5. "Hold SPACE" → Player holds space
6. Auto-advances!
7. ... continues through all steps
8. "Tutorial Complete!" → Tutorial closes
9. Player can now explore freely
```

## 🛠️ Troubleshooting

### Tutorial Won't Start
1. Check browser console for errors
2. Ensure localStorage isn't full
3. Try clearing cookies and cache
4. Make sure JavaScript is enabled

### Tutorial Won't Advance
1. Make sure you're doing the correct action
2. Check that panels are actually opening (I/R keys)
3. Try clicking "Next" if available
4. Use skip button if stuck

### Tutorial Keeps Reappearing
1. Check localStorage.getItem('tutorial_completed')
2. Should be 'true' after completion
3. If not, tutorial thinks you haven't finished
4. Complete it or skip it fully

## 📊 Analytics Ideas

You could track:
- How many players complete the tutorial
- Which step most players skip at
- Average completion time
- Which steps take longest
- Whether tutorial completion affects player retention

## 🎨 Customization Ideas

Make it your own:
- Change colors to match your brand
- Add your game's mascot/character
- Use different animations
- Add sound effects
- Include video clips
- Add mini-games for each concept

---

**Remember**: The goal is to get players into the game quickly while teaching them the basics. Keep it short, interactive, and skippable!

