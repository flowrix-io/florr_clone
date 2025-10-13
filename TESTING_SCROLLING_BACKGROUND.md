# Testing the Scrolling Background

## Quick Start
The scrolling background using `land.svg` has been successfully implemented! Here's how to test it:

## Running the Game

### Option 1: Local Development Server
```bash
# Build the project
npm run build

# Start the server
npm run build:server
node dist/server.js
```

Then open your browser to `http://localhost:3000` (or whatever port your server uses).

### Option 2: Direct File Access
1. Navigate to the `dist/` directory
2. Open `index.html` in a modern web browser

## What to Look For

### Expected Behavior
1. **Green Grass Background**: You should see a green background (#00d885) with darker green grass triangles
2. **Seamless Tiling**: The grass pattern should repeat seamlessly with no visible seams
3. **Smooth Scrolling**: As you move your character with WASD keys, the background should scroll smoothly
4. **Infinite Scrolling**: The background continues infinitely in all directions
5. **Zoom Compatibility**: When you zoom in (+) or out (-), the background tiles adjust properly

### Visual Characteristics
- **Base Color**: Bright green (#00d885)
- **Grass Elements**: 7 triangular grass shapes in darker green (#02c278)
- **Tile Size**: 400x400 pixels
- **Pattern**: Random grass triangles at different rotations and positions

## Testing Checklist

- [ ] Background loads without errors (check browser console)
- [ ] Green grass texture is visible
- [ ] Background scrolls when moving character
- [ ] No seams or gaps between tiles
- [ ] Zooming in/out works correctly
- [ ] Performance is smooth (no lag)

## Troubleshooting

### Background Not Loading
If you see a solid color instead of the grass pattern:
1. Check browser console for errors
2. Verify `dist/land.svg` exists
3. Clear browser cache and reload
4. Check that fetch requests are allowed (CORS)

### Console Messages
You should see:
```
Background SVG loaded successfully
```

If you see:
```
Failed to load background SVG
Fallback background loaded
```
The fallback is working but the SVG file wasn't found.

### Performance Issues
If the game lags:
- The tiling algorithm is optimized to only draw visible tiles
- Check browser performance tools for bottlenecks
- Try reducing zoom level

## Implementation Details

### Files Modified
1. `src/graphics.ts` - Added `drawScrollingBackground()` method
2. `src/game.ts` - Added `loadBackgroundFromSVG()` and `createFallbackBackground()` methods
3. `package.json` - Updated build script to copy land.svg
4. `src/land.svg` - The background tile source

### Key Features
- **Automatic Tiling**: Background tiles infinitely in all directions
- **Camera-Aware**: Tiles rendered based on camera position
- **Zoom-Responsive**: Tile count adjusts based on zoom level
- **Error Handling**: Graceful fallback if SVG fails to load
- **Performance Optimized**: Only draws visible tiles

## Advanced Testing

### Test Different Scenarios
1. **Movement**: Move in all 8 directions (N, NE, E, SE, S, SW, W, NW)
2. **Zoom**: Zoom in to 300% and out to 50%
3. **Fast Movement**: Hold movement keys and observe smoothness
4. **Teleportation**: If game has teleporters, test background continuity

### Browser Compatibility
Test in multiple browsers:
- Chrome/Edge (Chromium)
- Firefox
- Safari
- Mobile browsers

## Next Steps

The basic scrolling background is complete! Potential enhancements:
1. Add parallax layers for depth effect
2. Implement biome-specific backgrounds
3. Add animated grass elements
4. Create day/night variations
5. Add weather effects (rain, fog, etc.)

## Support

If you encounter issues:
1. Check the browser console for error messages
2. Verify all files in dist/ directory
3. Review `SCROLLING_BACKGROUND_IMPLEMENTATION.md` for technical details
4. Check that your browser supports SVG and Canvas 2D

