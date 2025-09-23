# 🌸 Florr.io Clone - Petal Battle Arena

A multiplayer browser-based survival game where players control flowers and use magical petals to battle creatures across different zones. Collect, craft, and equip various petal types to create the ultimate flower warrior!

## 🎮 Game Features

### 🌺 Core Petal System
- **Petal Collection**: Discover and collect different types of petals with unique abilities
- **Petal Crafting**: Combine petals to create more powerful variants
- **Loadout Management**: Equip up to 5 petals in your flower's loadout
- **Orbital Combat**: Petals orbit around your flower, automatically attacking nearby enemies
- **Petal Durability**: Petals have health and can break, requiring cooldown periods to regenerate

### 🌸 Petal Types & Rarities

#### Basic Petals
- **Common** to **Mythic** rarities
- Balanced stats for all-around combat
- Perfect for beginners and general use

#### Rose Petals
- **Thorny Defense**: Specialized for damage dealing
- **Crimson Power**: Higher damage output with unique visual effects
- **Royal Variants**: Majestic appearance with enhanced capabilities

#### Stinger Petals
- **Sharp Offense**: Fast, high-damage petals
- **Venomous Effects**: Poisonous variants with deadly precision
- **Void Stingers**: Mythic-tier petals that pierce reality itself

### 🌍 World & Zones

#### Zone Progression
1. **Common Zone** (Beginner Area) - 0-2000m
2. **Uncommon Zone** - 2000-4000m  
3. **Rare Zone** - 4000-6000m
4. **Epic Zone** - 6000-8000m
5. **Legendary Zone** - 8000-9000m
6. **Mythic Zone** (End-game) - 9000-10000m

#### World Features
- **Vast Ocean World**: 10,000 x 2,000 pixel explorable area
- **Zone-Specific Enemies**: Each zone features unique creature types
- **Dynamic Spawning**: Enemies and items spawn based on zone difficulty
- **Destructible Environment**: Coral obstacles and decorative elements

### ⚔️ Combat System

#### Petal Combat Mechanics
- **Orbital Movement**: Petals rotate around your flower at configurable distances
- **Automatic Targeting**: Petals automatically attack enemies within range
- **Damage Scaling**: Higher rarity petals deal more damage
- **Cooldown System**: Broken petals enter cooldown before regenerating
- **Petal Extension**: Adjust petal distance from your flower for tactical advantage

#### Enemy Types
- **Fish**: Directional movement patterns
- **Octopus**: Random movement with unpredictable behavior
- **Tier-Based Scaling**: Enemies scale in health, speed, and damage by zone

### 🎒 Inventory & Progression

#### Character Progression
- **Level System**: Progress from level 1 to 50
- **XP Gain**: Earn experience by defeating enemies
- **Stat Scaling**: Health and damage increase with each level
- **Inventory Management**: Store up to 5 different item types

#### Item System
- **Health Potions**: Restore 50% of your flower's health
- **Speed Boosts**: 2x movement speed for 10 seconds
- **Shields**: 50% damage reduction for protection
- **Petal Drops**: Collect new petals from defeated enemies

### 🛠️ Technical Features

#### Multiplayer Architecture
- **Real-time Multiplayer**: Play with other flower warriors
- **WebSocket Communication**: Low-latency networking
- **Client-Server Architecture**: Authoritative server with client prediction
- **Cross-Platform**: Works on any modern web browser

#### Performance Optimizations
- **Web Worker Support**: Offload game logic to background threads
- **Efficient Collision Detection**: Zone-based enemy updates
- **Asset Caching**: Optimized image and SVG loading
- **Delta Compression**: Reduced network traffic

## 🚀 Getting Started

### Prerequisites
- Node.js (v16 or higher)
- Modern web browser with WebSocket support
- Git

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/florr.io_clone.git
   cd florr.io_clone
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Build the project**
   ```bash
   npm run build
   ```

4. **Start the server**
   ```bash
   npm start
   ```

5. **Open your browser**
   Navigate to `http://localhost:3000` to start playing!

### Development Mode

For development with hot reloading:

```bash
# Terminal 1: Start the development server
npm run dev:server

# Terminal 2: Start the client build watcher
npm run dev
```

## 🎯 How to Play

### Basic Controls
- **WASD** or **Arrow Keys**: Move your flower
- **Mouse**: Aim and interact with UI elements
- **Space**: Use equipped items
- **I**: Open/close inventory
- **C**: Open crafting interface

### Gameplay Tips
1. **Start in Common Zone**: Begin your journey in the safest area
2. **Collect Petals**: Defeat enemies to collect new petal types
3. **Equip Strategically**: Balance offense and defense in your loadout
4. **Manage Distance**: Adjust petal extension for different combat situations
5. **Level Up**: Gain XP to increase your flower's power
6. **Explore Zones**: Venture into higher-tier areas for better rewards

### Petal Strategy
- **Basic Petals**: Great for beginners, balanced stats
- **Rose Petals**: High damage, good for aggressive play
- **Stinger Petals**: Fast attacks, perfect for hit-and-run tactics
- **Mix and Match**: Combine different petal types for versatile builds

## 🛠️ Development

### Project Structure
```
src/
├── game.ts              # Main game logic
├── graphics.ts          # Rendering and visual effects
├── petals.ts           # Petal system and configurations
├── player.ts           # Player character management
├── enemy.ts            # Enemy AI and behavior
├── inventory.ts        # Inventory and crafting system
├── server.ts           # Multiplayer server
└── socket.ts           # Client-server communication
```

### Key Technologies
- **TypeScript**: Type-safe development
- **Canvas API**: 2D rendering
- **Socket.io**: Real-time multiplayer
- **Web Workers**: Performance optimization
- **SQLite**: Player data persistence
- **Webpack**: Module bundling

### Contributing
1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

This project is licensed under the ISC License - see the [package.json](package.json) file for details.

## 🙏 Acknowledgments

- Inspired by the original [florr.io](https://florr.io) game
- Built with modern web technologies
- Community-driven development

---

**Ready to bloom into battle?** Start your petal-collecting adventure today! 🌸⚔️