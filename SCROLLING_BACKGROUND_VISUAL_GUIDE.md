# Scrolling Background - Visual Guide

## How the Tiling System Works

### The Tile Pattern

Each tile is 400x400 pixels with this pattern:

```
┌────────────────────────────────────────┐
│         Bright Green Background         │
│              (#00d885)                  │
│                                         │
│    🌿        🌿                         │
│         🌿              🌿              │
│                                         │
│                     🌿                  │
│         🌿                    🌿        │
│                                         │
└────────────────────────────────────────┘
```

Where 🌿 represents a triangular grass shape in darker green (#02c278)

### Seamless Tiling

The tiles are designed to connect seamlessly:

```
┌─────┬─────┬─────┐
│  🌿 │ 🌿  │  🌿 │  ← Tiles repeat infinitely
├─────┼─────┼─────┤
│ 🌿  │  🌿 │ 🌿  │  ← No visible seams
├─────┼─────┼─────┤
│  🌿 │ 🌿  │  🌿 │
└─────┴─────┴─────┘
```

### Scrolling Effect

As the camera moves, tiles are drawn at offset positions:

```
Step 1: Camera at (0, 0)
┌─────┬─────┬─────┐
│  🌿 │ 🌿  │  🌿 │
├─────┼─────┼─────┤
│ 🌿  │ [📹] │ 🌿 │  ← Camera centered
├─────┼─────┼─────┤
│  🌿 │ 🌿  │  🌿 │
└─────┴─────┴─────┘

Step 2: Camera moves right (+200, 0)
     ┌─────┬─────┬─────┐
     │  🌿 │ 🌿  │  🌿 │
     ├─────┼─────┼─────┤
     │ 🌿  │ [📹] │ 🌿 │  ← Camera moved
     ├─────┼─────┼─────┤
     │  🌿 │ 🌿  │  🌿 │
     └─────┴─────┴─────┘

Background appears to scroll left!
```

## Performance Optimization

### Culling Invisible Tiles

Only tiles in the viewport are drawn:

```
World (10000x10000):
┌───────────────────────────────────┐
│ 🌿 🌿 🌿 🌿 🌿 🌿 🌿 🌿 🌿 🌿 🌿 🌿 │
│ 🌿 🌿 🌿 🌿 🌿 🌿 🌿 🌿 🌿 🌿 🌿 🌿 │
│ 🌿 🌿 🌿┌─────────┐🌿 🌿 🌿 🌿 🌿 │
│ 🌿 🌿 🌿│ ✓ ✓ ✓   │🌿 🌿 🌿 🌿 🌿 │  ← Only these
│ 🌿 🌿 🌿│ ✓ ✓ ✓   │🌿 🌿 🌿 🌿 🌿 │     tiles drawn
│ 🌿 🌿 🌿└─────────┘🌿 🌿 🌿 🌿 🌿 │
│ 🌿 🌿 🌿 🌿 🌿 🌿 🌿 🌿 🌿 🌿 🌿 🌿 │
│ 🌿 🌿 🌿 🌿 🌿 🌿 🌿 🌿 🌿 🌿 🌿 🌿 │
└───────────────────────────────────┘
         Visible viewport
```

## Zoom Behavior

### Normal Zoom (1.0x)
```
┌────────────────────┐
│ 🌿    🌿    🌿     │
│    🌿    🌿    🌿  │  ~9 tiles visible
│ 🌿    🌿    🌿     │
└────────────────────┘
```

### Zoomed Out (0.5x)
```
┌────────────────────────────────┐
│🌿 🌿 🌿 🌿 🌿 🌿 🌿 🌿 🌿 🌿 🌿 🌿│
│🌿 🌿 🌿 🌿 🌿 🌿 🌿 🌿 🌿 🌿 🌿 🌿│  ~25 tiles visible
│🌿 🌿 🌿 🌿 🌿 🌿 🌿 🌿 🌿 🌿 🌿 🌿│
│🌿 🌿 🌿 🌿 🌿 🌿 🌿 🌿 🌿 🌿 🌿 🌿│
└────────────────────────────────┘
```

### Zoomed In (2.0x)
```
┌──────────┐
│          │
│  🌿      │  ~4 tiles visible
│          │
└──────────┘
```

## Algorithm Flow

```
┌─────────────────────┐
│  Start Frame        │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Get Camera Position │
│ Get Viewport Size   │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Calculate:          │
│ - Start tile X/Y    │
│ - Number of tiles   │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│ Loop through tiles: │
│ For each (x, y):    │
│   Draw tile         │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  End Frame          │
└─────────────────────┘
```

## Key Calculations

### Starting Tile Position
```typescript
startX = floor(cameraX / 400) * 400
startY = floor(cameraY / 400) * 400
```

Example:
- Camera at (1234, 5678)
- StartX = floor(1234/400) * 400 = 1200
- StartY = floor(5678/400) * 400 = 5600

### Number of Tiles
```typescript
tilesX = ceil(viewportWidth / 400) + 1
tilesY = ceil(viewportHeight / 400) + 1
```

Example:
- Viewport 1920x1080
- TilesX = ceil(1920/400) + 1 = 6
- TilesY = ceil(1080/400) + 1 = 4

### Drawing Position
```typescript
for i in 0..tilesX:
  for j in 0..tilesY:
    x = startX + (i * 400)
    y = startY + (j * 400)
    drawImage(background, x, y, 400, 400)
```

## Comparison

### Before (Static or No Background)
```
╔════════════════════╗
║                    ║
║    Just game       ║
║    objects on      ║
║    plain color     ║
║                    ║
╚════════════════════╝
```

### After (Scrolling Tiled Background)
```
╔════════════════════╗
║ 🌿  Player  🌿     ║
║     🌿      🌿     ║
║  🌿     Enemy      ║
║    🌿        🌿    ║
║ Background scrolls!║
╚════════════════════╝
```

## Browser Rendering

The browser sees:
```javascript
ctx.drawImage(land.svg, 0, 0, 400, 400)
ctx.drawImage(land.svg, 400, 0, 400, 400)
ctx.drawImage(land.svg, 800, 0, 400, 400)
ctx.drawImage(land.svg, 0, 400, 400, 400)
ctx.drawImage(land.svg, 400, 400, 400, 400)
// ... etc for all visible tiles
```

Each frame, positions update based on camera:
```javascript
// Frame 1: Camera at (0, 0)
Draw tiles at: (0,0), (400,0), (800,0)...

// Frame 2: Camera at (10, 0)
Draw tiles at: (0,0), (400,0), (800,0)...
// Same tiles, camera moved internally

// Frame 60: Camera at (600, 0)
Draw tiles at: (400,0), (800,0), (1200,0)...
// New tiles visible, old ones culled
```

## Tips for Customization

### Change Background Color
Edit line 2 in `src/land.svg`:
```svg
<rect width="400" height="400" fill="#00d885"/>
                                    ↑ Change this
```

### Add More Grass
Add more polygon elements:
```svg
<polygon points="0,-46.2 -40,23.1 40,23.1" 
         fill="#02c278" 
         transform="translate(150, 150) rotate(90)"/>
```

### Make Tiles Bigger/Smaller
Change the SVG dimensions:
```svg
<svg width="800" height="800">  <!-- Double size -->
```

Then update the tile size in code if needed.

## Troubleshooting Visual Issues

### Visible Seams
```
Wrong:                Right:
┌────┐┌────┐         ┌────┬────┐
│ 🌿 ││ 🌿 │         │ 🌿 │ 🌿 │
└────┘└────┘         └────┴────┘
  ↑ Gap!              ↑ Seamless!
```
Solution: Check tile calculations include +1 overlap

### Flickering
```
Frame 1: [  🌿  ]
Frame 2: [ 🌿   ]
Frame 3: [  🌿  ]
```
Solution: Ensure tiles are drawn every frame

### Wrong Offset
```
Should be:           Actually:
  ┌────┐              ┌────┐
  │ 🌿 │            ┌─│─🌿 │
  └────┘            │ └────┘
    ↑               ↓
 Camera          Camera
```
Solution: Check startX/startY calculations

---

This visual guide should help you understand how the scrolling background works under the hood! 🎮

