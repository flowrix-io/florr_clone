# Map Editor - Cross-Server Teleporter Guide

## 🎯 Overview

The map editor has been updated to support creating cross-server teleporters that can transfer players between different server instances while maintaining all their progress.

## 🆕 New Features

### 1. **Cross-Server Teleporter Configuration**
- **Server Port Selection**: Choose target server port from predefined options (3000, 3001, 3002) or enter custom port
- **Visual Indicators**: Cross-server teleporters display with gold diamond indicators and port numbers
- **Color-Coded Elements List**: Blue borders for cross-server, green for same-server teleporters

### 2. **Enhanced Map Validation**
- Validates server port ranges (1-65535)
- Counts and reports cross-server vs same-server teleporters
- Warns about custom ports that may not be configured
- Provides recommendations for testing

### 3. **Improved Visual Feedback**
- **Canvas Indicators**: Gold diamond markers on cross-server teleporters
- **Port Numbers**: Target server ports displayed on teleporters
- **Minimap Indicators**: Cross-server teleporters highlighted in gold
- **Tooltips**: Hover information for element types

## 🛠 How to Create Cross-Server Teleporters

### Step 1: Open the Map Editor
```bash
# Open MapEditor.html in your browser
open MapEditor.html
```

### Step 2: Select Teleporter Tool
1. Click the **"Teleporter"** button in the tools panel
2. The teleporter properties panel will appear

### Step 3: Configure Teleporter Properties
1. **Set Target Coordinates**:
   - Enter **X coordinate** for destination
   - Enter **Y coordinate** for destination

2. **Choose Server Port**:
   - **"Same Server (Local Teleport)"**: Creates regular teleporter (default)
   - **"Server 3000/3001/3002"**: Select predefined server port
   - **"Custom Port..."**: Enter custom port number (1-65535)

### Step 4: Draw the Teleporter
1. Click and drag on the canvas to create the teleporter area
2. The teleporter will be created with your configured properties
3. Cross-server teleporters will show a **gold diamond indicator** with the port number

### Step 5: Validate Your Map
1. Click **"Validate Map"** to check for issues
2. Review any errors, warnings, or recommendations
3. Fix any validation issues before exporting

### Step 6: Export Your Map
1. Click **"Export Map"** to download the JSON file
2. Place the exported map file in your game project
3. Update your game configuration to use the new map

## 📋 Example Configurations

### Same-Server Teleporter (Traditional)
```json
{
  "type": "teleporter",
  "x": 1000,
  "y": 1000,
  "width": 200,
  "height": 200,
  "properties": {
    "teleportTo": {
      "x": 2000,
      "y": 2000
    }
  }
}
```

### Cross-Server Teleporter (New!)
```json
{
  "type": "teleporter",
  "x": 1000,
  "y": 1000,
  "width": 200,
  "height": 200,
  "properties": {
    "teleportTo": {
      "x": 800,
      "y": 800,
      "serverPort": 3001
    }
  }
}
```

## 🎨 Visual Indicators Guide

### Canvas Indicators
- **Regular Teleporter**: Blue rectangle
- **Cross-Server Teleporter**: Blue rectangle with gold diamond and port number

### Element List Indicators
- **Green Border**: Same-server teleporter
- **Blue Border**: Cross-server teleporter
- **Format**: `teleporter (x, y) -> (target_x, target_y) [Port: xxxx]`

### Minimap Indicators
- **Blue**: Regular teleporter
- **Gold**: Cross-server teleporter

## 🔍 Map Validation Features

The validation system now checks for:

### ✅ **Errors** (Must Fix)
- Invalid element dimensions
- Missing teleporter configurations
- Invalid coordinates
- Invalid port ranges (< 1 or > 65535)

### ⚠️ **Warnings** (Recommended to Fix)
- Custom ports (ensure servers are configured)
- Missing spawn types
- No spawn points in map

### ℹ️ **Information** (Helpful Stats)
- Total element count
- Cross-server teleporter count and target ports
- Same-server teleporter count
- Spawn point count
- Setup reminders

## 🧪 Testing Your Cross-Server Map

### 1. Start Multiple Servers
```bash
# Use the provided script
./start_test_servers.sh

# Or manually:
PORT=3000 npm run start  # Terminal 1
PORT=3001 npm run start  # Terminal 2  
PORT=3002 npm run start  # Terminal 3
```

### 2. Load Your Map
- Place your exported map file in the appropriate location
- Restart servers to load the new map

### 3. Test Teleportation
1. Connect to https://localhost:3000
2. Find teleporters in the game world
3. Step into cross-server teleporters to test transfers
4. Monitor console logs for transfer events

## 💡 Best Practices

### 1. **Map Design**
- Place cross-server teleporters strategically (hubs, zone boundaries)
- Ensure each server has return teleporters
- Test all teleporter paths before deployment

### 2. **Server Configuration**
- Use consistent server configurations across all instances
- Ensure all target servers are running before testing
- Monitor server logs for transfer issues

### 3. **Performance**
- Limit the number of cross-server teleporters to avoid excessive transfers
- Consider player flow and server load balancing
- Place teleporters away from spawn areas to avoid accidental transfers

## 🐛 Troubleshooting

### Common Issues

1. **"Target server config not found"**
   - Verify all servers have matching configuration
   - Check `SERVER_CONFIGS` environment variable

2. **"Invalid server port" validation error**
   - Ensure port numbers are between 1-65535
   - Use only numeric values

3. **"Custom port" warning**
   - Configure the target server to run on the specified port
   - Update server configuration files if needed

### Debug Tips
- Use map validation before testing
- Check browser console for client errors
- Monitor server logs for transfer events
- Test with multiple players for race conditions

## 🎉 Advanced Features

### Dynamic Server Discovery
For production, consider extending the editor to:
- Load server configurations from external source
- Validate server availability in real-time
- Support geographic server selection

### Load Balancing Teleporters
Create teleporters that automatically direct players to less crowded servers based on current player counts.

---

## 🚀 Quick Start Example

1. **Open MapEditor.html**
2. **Select Teleporter tool**
3. **Set coordinates**: X: 800, Y: 800
4. **Select server**: "Server 3001 (Server2)"
5. **Draw teleporter** on canvas
6. **Validate map** (should show cross-server info)
7. **Export map** and test with running servers

The updated map editor makes it easy to create sophisticated multi-server game worlds with seamless player transfers!
