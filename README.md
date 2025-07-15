# Florr.io Clone - Multiplayer Game

A multiplayer game built with TypeScript frontend and C++ server, featuring players with orbiting defense circles fighting against AI mobs.

## Features

- **Player System**: Players with 5 orbiting circles for defense
- **Mob System**: AI enemies (bird, bee, cat, mouse) that attack players
- **Multiplayer**: Real-time multiplayer using WebSockets
- **Real-time Combat**: Mobs can only be damaged by orbiting circles
- **SVG Graphics**: Custom SVG assets for all game entities

## Game Mechanics

- **Player Movement**: Move your character by moving your mouse
- **Orbiting Defense**: 5 colored circles orbit around your player
- **Mob AI**: Mobs spawn randomly and chase the nearest player
- **Combat System**: 
  - Mobs take damage when touching your orbiting circles
  - Mobs can damage you when touching your player character
  - Different mob types have different health, speed, and size

## Project Structure

```
florr.io_clone/
├── frontend/           # TypeScript frontend
│   ├── src/
│   │   ├── main.ts     # Entry point
│   │   ├── Game.ts     # Main game class
│   │   ├── NetworkManager.ts  # WebSocket client
│   │   ├── AssetManager.ts    # SVG asset loading
│   │   └── types.ts    # TypeScript interfaces
│   ├── index.html      # HTML game page
│   └── package.json    # Frontend dependencies
├── server/             # C++ server
│   ├── src/
│   │   ├── main.cpp    # WebSocket server
│   │   ├── GameServer.cpp  # Game logic
│   │   ├── Player.cpp  # Player entity
│   │   └── Mob.cpp     # Mob entity
│   ├── CMakeLists.txt  # Build configuration
│   └── build.sh        # Build script
└── *.svg               # Game assets
```

## Prerequisites

### Frontend
- Node.js (v16 or higher)
- npm or yarn

### Server
- C++20 compatible compiler (GCC 10+, Clang 10+, MSVC 19.29+)
- CMake 3.16+
- WebSocket++ library
- nlohmann/json library
- Boost libraries

## Installation

### Frontend Setup

1. Navigate to the frontend directory:
```bash
cd frontend
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```

The frontend will be available at `http://localhost:3000`

### Server Setup

#### Ubuntu/Debian
```bash
# Install dependencies
sudo apt-get update
sudo apt-get install build-essential cmake libwebsocketpp-dev nlohmann-json3-dev libboost-all-dev

# Navigate to server directory
cd server

# Make build script executable
chmod +x build.sh

# Build the server
./build.sh
```

#### macOS
```bash
# Install dependencies with Homebrew
brew install cmake websocketpp nlohmann-json boost

# Navigate to server directory
cd server

# Make build script executable
chmod +x build.sh

# Build the server
./build.sh
```

#### Windows
1. Install Visual Studio 2019 or later with C++ support
2. Install vcpkg package manager
3. Install dependencies:
```cmd
vcpkg install websocketpp nlohmann-json boost
```
4. Use CMake GUI or command line to build the project

## Running the Game

1. **Start the server** (from server directory):
```bash
cd server/build
./florr_server
```
The server will start on port 8080.

2. **Start the frontend** (from frontend directory):
```bash
npm run dev
```
The game will be available at `http://localhost:3000`

3. **Open multiple browser tabs** to test multiplayer functionality

## Game Controls

- **Mouse Movement**: Move your mouse to control your player
- **Automatic Combat**: Your orbiting circles automatically damage mobs on contact
- **Health Management**: Avoid direct contact with mobs to prevent taking damage

## Architecture

### Frontend (TypeScript)
- **Canvas Rendering**: HTML5 Canvas for 2D graphics
- **Real-time Updates**: WebSocket connection for multiplayer sync
- **Asset Management**: SVG loading and rendering system
- **Game Loop**: 60 FPS game loop with delta time calculations

### Server (C++)
- **WebSocket Server**: Handles multiple client connections
- **Game Logic**: Server-authoritative game state management
- **AI System**: Mob spawning and pathfinding
- **Physics**: Collision detection and movement validation

## Development

### Frontend Development
```bash
cd frontend
npm run dev    # Development server with hot reload
npm run build  # Production build
```

### Server Development
```bash
cd server
./build.sh     # Rebuild server
```

## Multiplayer Features

- **Real-time Synchronization**: All players see the same game state
- **Player Management**: Join/leave handling with proper cleanup
- **State Broadcasting**: Efficient game state updates to all clients
- **Connection Handling**: Automatic reconnection and error handling

## Customization

- **Mob Types**: Add new mob types by extending the `MobType` enum
- **Player Abilities**: Modify orbiting circle properties in `Player.cpp`
- **Game Balance**: Adjust health, speed, and damage values
- **Visual Assets**: Replace SVG files with custom artwork

## Troubleshooting

### Common Issues

1. **Server won't start**: Check if port 8080 is available
2. **Frontend can't connect**: Ensure server is running and firewall allows connection
3. **Build errors**: Verify all dependencies are installed correctly
4. **Assets not loading**: Check SVG file paths in `AssetManager.ts`

### Performance Tips

- **Reduce mob spawn rate**: Modify `MOB_SPAWN_RATE` in `GameServer.h`
- **Optimize rendering**: Adjust canvas size or implement viewport culling
- **Network optimization**: Reduce update frequency for better performance

## License

This project is open source and available under the MIT License.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## Future Enhancements

- [ ] Power-ups and upgrades
- [ ] Different game modes
- [ ] Player progression system
- [ ] Enhanced graphics and animations
- [ ] Mobile support
- [ ] Spectator mode
- [ ] Leaderboards