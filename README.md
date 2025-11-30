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
- **Item Spawner**: Special non-hostile enemy that spawns random petals when hit (1% chance per petal hit)
  - Does not damage players but applies knockback
  - Still damages player petals (50 damage per hit)
  - Items spawn outside the spawner's hitbox to prevent overlap
  - Weighted rarity system: Common items are much more likely than rare items

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
- **Item Spawner Drops**: Hit item spawners with petals for a 1% chance to receive random petals
  - Rarity distribution: Common (30%), Uncommon (10%), Rare (10%), Epic (5%), Legendary (5%), Mythic (5%), Ultra (5%), Super (5%), Unique (0.05%)
  - Only the player who hit the spawner can pick up the dropped item

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

## 🎮 Server Commands & Admin System

### Server Console Commands

The server supports commands via stdin (standard input) for server administration:

#### Player Management
- `save` - Save all players' progress
- `save <playerId>` - Save specific player's progress
- `list-players` - List all connected players with their IDs and levels
- `list-sockets` - List all socket connections

#### Enemy Management
- `spawn <mobType> <rarity>` - Spawn a specific mob with a specific rarity
  - Example: `spawn bee rare`
  - Example: `spawn octopus legendary 1000 2000` (with coordinates)
- `spawn_special_mobs` - Spawn special mobs (ultra, super, unique)
- `set_max_enemies <count>` - Set the maximum number of enemies

#### Available Mob Types
All mob types from the game can be spawned: `bee`, `octopus`, `fish`, `shark`, `ladybug`, `soldier_ant`, `hornet`, `mantis`, `leafbug`, `bush`, `target_dummy`, `item_spawner`

#### Available Rarities
`common`, `uncommon`, `rare`, `epic`, `legendary`, `mythic`, `ultra`, `super`, `unique`

### Admin System

#### Setting Up Admin Users

To grant admin privileges to a user, edit `dist/inventory.json` (or the database file) and add `"admin": true` to the user object:

```json
{
  "users": {
    "your_username": {
      "id": "...",
      "username": "your_username",
      "password": "...",
      "admin": true
    }
  }
}
```

#### Admin Chat Commands

Admin players can execute server commands directly from the in-game chat:

- `/admin <command>` - Execute a server command
- `/cmd <command>` - Alternative prefix for admin commands

**Examples:**
- `/admin spawn bee rare` - Spawn a rare bee
- `/admin spawn octopus legendary 1000 2000` - Spawn at specific coordinates
- `/admin list-players` - List all players
- `/admin set_max_enemies 100` - Set max enemy count

#### Security Features
- Admin commands are hidden from non-admin users in `/help`
- Non-admin users attempting to use admin commands receive "Command does not exist" message
- All admin command executions are logged to the server console
- Admin status is checked server-side for security

### Chat Commands

All players can use these chat commands:

- `/help` - Show available commands (admin commands only visible to admins)
- `/list_ultra` - List all ultra mobs in the world
- `/list_super` - List all super mobs
- `/list_unique` - List all unique mobs
- `/list_legendary` - List all legendary mobs
- `/list_mythic` - List all mythic mobs
- `/list_epic` - List all epic mobs
- `/list_rare` - List all rare mobs
- `/list_uncommon` - List all uncommon mobs
- `/list_common` - List all common mobs
- `/list_all` - List all mobs

Chat also supports HTML formatting:
- `<b>bold</b>` - Bold text
- `<i>italic</i>` - Italic text
- `<u>underline</u>` - Underlined text
- `<span style="color: red">colored text</span>` - Colored text
- `<blink>blinking text</blink>` - Blinking text

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