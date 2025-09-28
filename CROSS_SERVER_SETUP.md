# Cross-Server Teleportation Setup Guide

## Overview

This florr.io clone now supports cross-server teleportation, allowing players to seamlessly move between different server instances running on different ports.

## Features

- **Cross-Server Teleporters**: Teleporters can now send players to different servers
- **Server Configuration**: Easy configuration of multiple server instances
- **Player Data Transfer**: Complete player progress is maintained across servers
- **Visual Feedback**: Players see transfer progress and teleport effects
- **Automatic Reconnection**: Clients automatically connect to target servers

## Setup Instructions

### 1. Server Configuration

You can configure multiple servers in several ways:

#### Option A: Environment Variable
Set the `SERVER_CONFIGS` environment variable with JSON:
```bash
export SERVER_CONFIGS='[
  { "port": 3000, "host": "localhost", "name": "Server1" },
  { "port": 3001, "host": "localhost", "name": "Server2" },
  { "port": 3002, "host": "localhost", "name": "Server3" }
]'
```

#### Option B: Default Configuration (Automatic)
If no environment variable is set, the system uses these defaults:
- Server1: localhost:3000
- Server2: localhost:3001  
- Server3: localhost:3002

### 2. Starting Multiple Servers

To test cross-server functionality, you need to run multiple server instances:

#### Terminal 1 (Server 3000):
```bash
npm run build:server
PORT=3000 node dist/server.js
```

#### Terminal 2 (Server 3001):
```bash
PORT=3001 node dist/server.js
```

#### Terminal 3 (Server 3002):
```bash
PORT=3002 node dist/server.js
```

### 3. Adding Cross-Server Teleporters

To add cross-server teleporters to your map, include the `serverPort` property in the `teleportTo` configuration:

```typescript
{
  type: 'teleporter',
  x: 2000,
  y: 1000, 
  width: 300,
  height: 300,
  properties: {
    teleportTo: {
      x: 800,        // Target X coordinate
      y: 800,        // Target Y coordinate  
      serverPort: 3001  // Target server port (omit for same-server teleport)
    }
  }
}
```

### 4. Example Teleporter Configuration

Pre-configured example teleporters are available in `src/constants.ts` as `EXAMPLE_CROSS_SERVER_TELEPORTERS`. You can add these to your `WORLD_MAP` for testing:

```typescript
// Add to your WORLD_MAP array in constants.ts
...EXAMPLE_CROSS_SERVER_TELEPORTERS
```

## How It Works

### Server-Side Flow
1. Player touches a cross-server teleporter
2. Server saves player progress to database
3. Server sends HTTP request to target server with player data
4. Target server creates temporary player entry with transfer token
5. Source server notifies client about transfer
6. Source server removes player after delay

### Client-Side Flow
1. Client receives transfer notification
2. Client disconnects from current server
3. Client connects to target server
4. Client claims transferred player using transfer token
5. Client resumes gameplay on new server

### Same-Server Teleportation
Regular teleporters (without `serverPort`) work as before:
- Instant position change within the same server
- No reconnection required
- Visual teleport effect displayed

## Security Considerations

- Transfer tokens are single-use and expire
- Player data is validated on both servers
- HTTPS required for secure data transfer
- Authentication state is preserved across transfers

## Troubleshooting

### Common Issues

1. **"Target server config not found"**
   - Ensure all servers in the network have the same server configuration
   - Check that `SERVER_CONFIGS` environment variable is properly set

2. **"Failed to connect to target server"**
   - Verify target server is running and accessible
   - Check SSL certificates are properly configured
   - Ensure firewall allows connections between servers

3. **"Transfer failed"**
   - Check server logs for detailed error messages
   - Verify database is working and player data can be saved
   - Ensure target server has sufficient resources

### Debug Mode
Enable detailed logging by checking server console outputs. Transfer events are logged with `[SERVER ServerName]` prefixes.

## Performance Notes

- Cross-server transfers involve network requests, so some latency is expected
- Player data is compressed and only essential information is transferred
- Database saves occur before transfers to ensure data persistence
- Cleanup processes remove stale transfer tokens automatically

## Advanced Configuration

### Custom Server Discovery
For production deployments, you can implement custom server discovery by modifying the `getServerConfigs()` function in `constants.ts`.

### Load Balancing  
Cross-server teleporters can be used for load balancing by directing players to less populated servers based on server metrics.

### Network Topology
Configure servers in different geographic regions and use teleporters to allow players to switch regions while maintaining their progress.
