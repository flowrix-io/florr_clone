"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLAYER_SIZE = exports.DAMAGE_PER_LEVEL = exports.HEALTH_PER_LEVEL = exports.XP_MULTIPLIER = exports.BASE_XP_REQUIREMENT = exports.KNOCKBACK_RECOVERY_SPEED = exports.KNOCKBACK_FORCE = exports.MAX_SPEED = exports.RESPAWN_INVULNERABILITY_TIME = exports.MAX_INVENTORY_SIZE = exports.ENEMY_TIERS = exports.MAX_SAND_RADIUS = exports.MIN_SAND_RADIUS = exports.SAND_COUNT = exports.DECORATION_COUNT = exports.ENEMY_DAMAGE = exports.PLAYER_DAMAGE = exports.ENEMY_MAX_HEALTH = exports.PLAYER_MAX_HEALTH = exports.ENEMY_CORAL_DAMAGE = exports.ENEMY_CORAL_HEALTH = exports.ENEMY_CORAL_PROBABILITY = exports.OBSTACLE_COUNT = exports.SCALE_FACTOR = exports.PVP_WORLD_HEIGHT = exports.PVP_WORLD_WIDTH = exports.OLD_WORLD_HEIGHT = exports.OLD_WORLD_WIDTH = exports.ENEMIES_PER_VIEWPORT = exports.VIEWPORT_WITH_BUFFER_AREA = exports.ORIGINAL_ENEMY_DENSITY = exports.ORIGINAL_ENEMY_COUNT = exports.TOTAL_WORLD_AREA = exports.ACTUAL_WORLD_HEIGHT = exports.ACTUAL_WORLD_WIDTH = exports.WORLD_HEIGHT = exports.WORLD_WIDTH = exports.items = exports.obstacles = exports.enemies = exports.dots = exports.players = exports.VIEWPORT_AREA = exports.VIEWPORT_HEIGHT = exports.VIEWPORT_WIDTH = exports.ENEMY_DESPAWN_TIME = exports.VIEWPORT_BUFFER = exports.FISH_RETURN_SPEED = exports.PLAYER_BASE_SPEED = exports.FISH_DETECTION_RADIUS = void 0;
exports.EXAMPLE_CROSS_SERVER_TELEPORTERS = exports.DEFAULT_SERVER_CONFIGS = exports.WORLD_MAP = exports.MAZE_WALL_THICKNESS = exports.MAZE_CELL_SIZE = exports.DROP_CHANCES = exports.ENEMY_SIZE_MULTIPLIERS = exports.ZONE_BOUNDARIES = exports.ENEMY_SIZE = void 0;
exports.validateWorldMap = validateWorldMap;
exports.isWall = isWall;
exports.isSpawn = isSpawn;
exports.isTeleporter = isTeleporter;
exports.isSafeZone = isSafeZone;
exports.getServerConfigs = getServerConfigs;
exports.getServerConfigByPort = getServerConfigByPort;
// Add these constants at the top with the others
exports.FISH_DETECTION_RADIUS = 500; // How far fish can detect players
exports.PLAYER_BASE_SPEED = 5; // Base player speed to match
exports.FISH_RETURN_SPEED = 0.5; // Speed at which fish return to their normal behavior
// Viewport optimization constants
exports.VIEWPORT_BUFFER = 500; // Extra distance beyond viewport to keep enemies active
exports.ENEMY_DESPAWN_TIME = 30000; // 30 seconds in milliseconds
// Viewport dimensions
exports.VIEWPORT_WIDTH = 1920;
exports.VIEWPORT_HEIGHT = 1080;
exports.VIEWPORT_AREA = exports.VIEWPORT_WIDTH * exports.VIEWPORT_HEIGHT; // 2,073,600 pixels²
exports.players = {};
exports.dots = [];
exports.enemies = [];
exports.obstacles = [];
exports.items = [];
exports.WORLD_WIDTH = 20000;
exports.WORLD_HEIGHT = 20000;
exports.ACTUAL_WORLD_WIDTH = 20000;
exports.ACTUAL_WORLD_HEIGHT = 20000;
// Density calculation constants (defined after world dimensions)
exports.TOTAL_WORLD_AREA = exports.ACTUAL_WORLD_WIDTH * exports.ACTUAL_WORLD_HEIGHT; // 400,000,000 pixels²
exports.ORIGINAL_ENEMY_COUNT = 1000;
exports.ORIGINAL_ENEMY_DENSITY = exports.ORIGINAL_ENEMY_COUNT / exports.TOTAL_WORLD_AREA; // 0.0000025 enemies per pixel²
exports.VIEWPORT_WITH_BUFFER_AREA = (exports.VIEWPORT_WIDTH + exports.VIEWPORT_BUFFER * 2) * (exports.VIEWPORT_HEIGHT + exports.VIEWPORT_BUFFER * 2); // 6,073,600 pixels²
exports.ENEMIES_PER_VIEWPORT = Math.ceil(exports.ORIGINAL_ENEMY_DENSITY * exports.VIEWPORT_WITH_BUFFER_AREA); // ~15 enemies per viewport
exports.OLD_WORLD_WIDTH = 10000;
exports.OLD_WORLD_HEIGHT = 2000;
exports.PVP_WORLD_WIDTH = 10000;
exports.PVP_WORLD_HEIGHT = 10000;
exports.SCALE_FACTOR = 1;
//export let ENEMY_COUNT = 200;
exports.OBSTACLE_COUNT = 20;
exports.ENEMY_CORAL_PROBABILITY = 0.3;
exports.ENEMY_CORAL_HEALTH = 50;
exports.ENEMY_CORAL_DAMAGE = 5;
exports.PLAYER_MAX_HEALTH = 100;
exports.ENEMY_MAX_HEALTH = 50;
exports.PLAYER_DAMAGE = 5;
exports.ENEMY_DAMAGE = 20;
exports.DECORATION_COUNT = 100;
exports.SAND_COUNT = 50; // Reduced from 200 to 50
exports.MIN_SAND_RADIUS = 50; // Increased from 30 to 50
exports.MAX_SAND_RADIUS = 120; // Increased from 80 to 120
exports.ENEMY_TIERS = {
    common: { health: 5, speed: 0.5, damage: 5, probability: 0.4, color: '#7eef6d' },
    uncommon: { health: 40, speed: 0.75, damage: 10, probability: 0.3, color: '#ffe65d' },
    rare: { health: 60, speed: 1, damage: 15, probability: 0.15, color: '#4d52e3' },
    epic: { health: 80, speed: 1.25, damage: 20, probability: 0.1, color: '#861fde' },
    legendary: { health: 100, speed: 1.5, damage: 25, probability: 0.04, color: '#1fdbde' },
    mythic: { health: 150, speed: 2, damage: 30, probability: 0.01, color: '#de1f65' },
    ultra: { health: 450, speed: 2, damage: 90, probability: 0.0001, color: '#de1f65' }
};
exports.MAX_INVENTORY_SIZE = 5;
exports.RESPAWN_INVULNERABILITY_TIME = 3000; // 3 seconds of invulnerability after respawn
exports.MAX_SPEED = 90;
// Add knockback constants at the top with other constants
exports.KNOCKBACK_FORCE = 5; // Reduced for faster movement with many enemies
exports.KNOCKBACK_RECOVERY_SPEED = 0.7; // Faster decay to reduce movement resistance
// Add XP-related constants
exports.BASE_XP_REQUIREMENT = 100;
exports.XP_MULTIPLIER = 1.25;
exports.HEALTH_PER_LEVEL = 10;
exports.DAMAGE_PER_LEVEL = 2;
exports.PLAYER_SIZE = 40;
exports.ENEMY_SIZE = 40;
// Define zone boundaries for different tiers
exports.ZONE_BOUNDARIES = {
    common: { start: 0, end: 4000 },
    uncommon: { start: 4000, end: 8000 },
    rare: { start: 8000, end: 12000 },
    epic: { start: 12000, end: 16000 },
    legendary: { start: 16000, end: 18000 },
    mythic: { start: 18000, end: exports.WORLD_WIDTH }
};
// Add enemy size multipliers like in singleplayer
exports.ENEMY_SIZE_MULTIPLIERS = {
    common: 1.0,
    uncommon: 1.2,
    rare: 1.4,
    epic: 1.6,
    legendary: 1.8,
    mythic: 2.0,
    ultra: 2.5,
    super: 3.0,
    unique: 3.5
};
// Add drop chances like in singleplayer
exports.DROP_CHANCES = {
    common: 0.1, // 10% chance
    uncommon: 0.2, // 20% chance
    rare: 0.3, // 30% chance
    epic: 0.4, // 40% chance
    legendary: 0.5, // 50% chance
    mythic: 0.75, // 75% chance
    ultra: 0.9, // 90% chance
    super: 0.95, // 95% chance
    unique: 1.0 // 100% chance
};
// Add maze configuration
exports.MAZE_CELL_SIZE = 1000; // Size of each maze cell
exports.MAZE_WALL_THICKNESS = 100; // Thickness of maze walls
// Define the permanent map layout
exports.WORLD_MAP = [
    {
        "type": "wall",
        "x": 28.28125,
        "y": 80,
        "width": 20,
        "height": 19890,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 48.28125,
        "y": 100,
        "width": 19840,
        "height": 40,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 19818.28125,
        "y": 130,
        "width": 40,
        "height": 19830,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 38.28125,
        "y": 19880,
        "width": 19790,
        "height": 50,
        "properties": {}
    },
    {
        "type": "spawn",
        "x": 178.28125,
        "y": 9290,
        "width": 1550,
        "height": 1730,
        "properties": {
            "spawnType": "common"
        }
    },
    {
        "type": "spawn",
        "x": 248.28125,
        "y": 7820,
        "width": 2780,
        "height": 1430,
        "properties": {
            "spawnType": "common"
        }
    },
    {
        "type": "wall",
        "x": 2308.28125,
        "y": 9670,
        "width": 200,
        "height": 2860,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 428.28125,
        "y": 6650,
        "width": 3590,
        "height": 270,
        "properties": {}
    },
    {
        "type": "spawn",
        "x": 468.28125,
        "y": 11270,
        "width": 1510,
        "height": 1490,
        "properties": {
            "spawnType": "uncommon"
        }
    },
    {
        "type": "spawn",
        "x": 1228.28125,
        "y": 13030,
        "width": 4250,
        "height": 1150,
        "properties": {
            "spawnType": "uncommon"
        }
    },
    {
        "type": "wall",
        "x": 4368.28125,
        "y": 13890,
        "width": 310,
        "height": 2890,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 4558.28125,
        "y": 13870,
        "width": 5680,
        "height": 260,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 5858.28125,
        "y": 8830,
        "width": 250,
        "height": 3980,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 1078.28125,
        "y": 1760,
        "width": 270,
        "height": 390,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 2848.28125,
        "y": 3610,
        "width": 350,
        "height": 450,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 4448.28125,
        "y": 820,
        "width": 340,
        "height": 270,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 528.28125,
        "y": 5380,
        "width": 170,
        "height": 210,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 18.28125,
        "y": 6670,
        "width": 510,
        "height": 190,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 3978.28125,
        "y": 6390,
        "width": 2540,
        "height": 320,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 6138.28125,
        "y": 4290,
        "width": 260,
        "height": 2150,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 6748.28125,
        "y": 7470,
        "width": 2560,
        "height": 170,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 7588.28125,
        "y": 8670,
        "width": 200,
        "height": 1080,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 7728.28125,
        "y": 9610,
        "width": 3070,
        "height": 140,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 8368.28125,
        "y": 9760,
        "width": 150,
        "height": 1580,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 8488.28125,
        "y": 11270,
        "width": 1540,
        "height": 140,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 9048.28125,
        "y": 9730,
        "width": 180,
        "height": 1050,
        "properties": {}
    },
    {
        "type": "spawn",
        "x": 318.28125,
        "y": 490,
        "width": 2960,
        "height": 5540,
        "properties": {
            "spawnType": "uncommon"
        }
    },
    {
        "type": "spawn",
        "x": 3428.28125,
        "y": 530,
        "width": 2670,
        "height": 5460,
        "properties": {
            "spawnType": "mythic"
        }
    },
    {
        "type": "wall",
        "x": 6178.28125,
        "y": 2820,
        "width": 1380,
        "height": 120,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 6958.28125,
        "y": 2920,
        "width": 170,
        "height": 1370,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 8878.28125,
        "y": 4620,
        "width": 3370,
        "height": 190,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 8918.28125,
        "y": 120,
        "width": 140,
        "height": 4510,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 7308.28125,
        "y": 1380,
        "width": 1670,
        "height": 170,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 6358.28125,
        "y": 5550,
        "width": 3390,
        "height": 160,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 9258.28125,
        "y": 6470,
        "width": 150,
        "height": 1030,
        "properties": {}
    },
    {
        "type": "spawn",
        "x": 3078.28125,
        "y": 7680,
        "width": 2710,
        "height": 1460,
        "properties": {
            "spawnType": "legendary"
        }
    },
    {
        "type": "spawn",
        "x": 5948.28125,
        "y": 6950,
        "width": 750,
        "height": 1780,
        "properties": {
            "spawnType": "rare"
        }
    },
    {
        "type": "spawn",
        "x": 7168.28125,
        "y": 6090,
        "width": 1970,
        "height": 1230,
        "properties": {
            "spawnType": "epic"
        }
    },
    {
        "type": "spawn",
        "x": 7228.28125,
        "y": 3080,
        "width": 1610,
        "height": 2370,
        "properties": {
            "spawnType": "epic"
        }
    },
    {
        "type": "spawn",
        "x": 6248.28125,
        "y": 3100,
        "width": 610,
        "height": 1040,
        "properties": {
            "spawnType": "epic"
        }
    },
    {
        "type": "spawn",
        "x": 6498.28125,
        "y": 4350,
        "width": 560,
        "height": 1010,
        "properties": {
            "spawnType": "legendary"
        }
    },
    {
        "type": "spawn",
        "x": 2628.28125,
        "y": 9420,
        "width": 3090,
        "height": 3400,
        "properties": {
            "spawnType": "legendary"
        }
    },
    {
        "type": "spawn",
        "x": 398.28125,
        "y": 14250,
        "width": 3950,
        "height": 1510,
        "properties": {
            "spawnType": "rare"
        }
    },
    {
        "type": "wall",
        "x": 2208.28125,
        "y": 13980,
        "width": 220,
        "height": 4680,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 1078.28125,
        "y": 18340,
        "width": 1160,
        "height": 240,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 2358.28125,
        "y": 18550,
        "width": 8030,
        "height": 270,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 4648.28125,
        "y": 15320,
        "width": 2140,
        "height": 220,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 6078.28125,
        "y": 14080,
        "width": 210,
        "height": 830,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 4628.28125,
        "y": 16670,
        "width": 3110,
        "height": 140,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 7128.28125,
        "y": 15830,
        "width": 160,
        "height": 880,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 8818.28125,
        "y": 14130,
        "width": 200,
        "height": 3440,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 10178.28125,
        "y": 14060,
        "width": 160,
        "height": 3350,
        "properties": {}
    },
    {
        "type": "spawn",
        "x": 2638.28125,
        "y": 16950,
        "width": 5990,
        "height": 1450,
        "properties": {
            "spawnType": "rare"
        }
    },
    {
        "type": "spawn",
        "x": 6398.28125,
        "y": 9070,
        "width": 1080,
        "height": 4560,
        "properties": {
            "spawnType": "rare"
        }
    },
    {
        "type": "spawn",
        "x": 8578.28125,
        "y": 8010,
        "width": 6480,
        "height": 1540,
        "properties": {
            "spawnType": "rare"
        }
    },
    {
        "type": "spawn",
        "x": 9088.28125,
        "y": 14210,
        "width": 1010,
        "height": 4030,
        "properties": {
            "spawnType": "rare"
        }
    },
    {
        "type": "wall",
        "x": 11908.28125,
        "y": 9630,
        "width": 250,
        "height": 5120,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 10978.28125,
        "y": 14410,
        "width": 980,
        "height": 200,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 10618.28125,
        "y": 7630,
        "width": 2610,
        "height": 230,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 15008.28125,
        "y": 15060,
        "width": 260,
        "height": 3420,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 14368.28125,
        "y": 10860,
        "width": 330,
        "height": 360,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 16248.28125,
        "y": 11320,
        "width": 320,
        "height": 400,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 13328.28125,
        "y": 13280,
        "width": 290,
        "height": 290,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 17128.28125,
        "y": 13410,
        "width": 300,
        "height": 310,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 14798.28125,
        "y": 12820,
        "width": 260,
        "height": 200,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 17118.28125,
        "y": 9130,
        "width": 370,
        "height": 310,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 15498.28125,
        "y": 9660,
        "width": 320,
        "height": 220,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 13598.28125,
        "y": 8540,
        "width": 200,
        "height": 240,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 12658.28125,
        "y": 10610,
        "width": 320,
        "height": 260,
        "properties": {}
    },
    {
        "type": "spawn",
        "x": 12558.28125,
        "y": 10190,
        "width": 5100,
        "height": 4540,
        "properties": {
            "spawnType": "rare"
        }
    },
    {
        "type": "spawn",
        "x": 15518.28125,
        "y": 15120,
        "width": 3800,
        "height": 3930,
        "properties": {
            "spawnType": "epic"
        }
    },
    {
        "type": "spawn",
        "x": 5088.28125,
        "y": 19000,
        "width": 1300,
        "height": 810,
        "properties": {
            "spawnType": "legendary"
        }
    },
    {
        "type": "spawn",
        "x": 8348.28125,
        "y": 19080,
        "width": 1230,
        "height": 700,
        "properties": {
            "spawnType": "legendary"
        }
    },
    {
        "type": "spawn",
        "x": 6538.28125,
        "y": 19050,
        "width": 1550,
        "height": 730,
        "properties": {
            "spawnType": "legendary"
        }
    },
    {
        "type": "spawn",
        "x": 388.28125,
        "y": 18910,
        "width": 4400,
        "height": 840,
        "properties": {
            "spawnType": "mythic"
        }
    },
    {
        "type": "wall",
        "x": 11448.28125,
        "y": 1810,
        "width": 200,
        "height": 2810,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 12188.28125,
        "y": 4780,
        "width": 3860,
        "height": 200,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 11998.28125,
        "y": 5620,
        "width": 220,
        "height": 2030,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 14218.28125,
        "y": 5010,
        "width": 300,
        "height": 2280,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 14228.28125,
        "y": 4930,
        "width": 280,
        "height": 150,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 12998.28125,
        "y": 6020,
        "width": 1260,
        "height": 210,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 14468.28125,
        "y": 6660,
        "width": 1420,
        "height": 290,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 12858.28125,
        "y": 1030,
        "width": 4230,
        "height": 190,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 16948.28125,
        "y": 1190,
        "width": 190,
        "height": 4520,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 13008.28125,
        "y": 1690,
        "width": 3450,
        "height": 210,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 16348.28125,
        "y": 2010,
        "width": 210,
        "height": 3700,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 13078.28125,
        "y": 2460,
        "width": 2880,
        "height": 160,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 15758.28125,
        "y": 2800,
        "width": 210,
        "height": 1720,
        "properties": {}
    },
    {
        "type": "spawn",
        "x": 12928.28125,
        "y": 1280,
        "width": 3880,
        "height": 330,
        "properties": {
            "spawnType": "epic"
        }
    },
    {
        "type": "spawn",
        "x": 16668.28125,
        "y": 1620,
        "width": 260,
        "height": 4260,
        "properties": {
            "spawnType": "rare"
        }
    },
    {
        "type": "spawn",
        "x": 12948.28125,
        "y": 2050,
        "width": 3280,
        "height": 320,
        "properties": {
            "spawnType": "rare"
        }
    },
    {
        "type": "spawn",
        "x": 16048.28125,
        "y": 2370,
        "width": 260,
        "height": 3260,
        "properties": {
            "spawnType": "uncommon"
        }
    },
    {
        "type": "spawn",
        "x": 14978.28125,
        "y": 2650,
        "width": 700,
        "height": 2000,
        "properties": {
            "spawnType": "common"
        }
    },
    {
        "type": "spawn",
        "x": 13078.28125,
        "y": 2690,
        "width": 1800,
        "height": 1900,
        "properties": {
            "spawnType": "legendary"
        }
    },
    {
        "type": "wall",
        "x": 10028.28125,
        "y": 110,
        "width": 390,
        "height": 3940,
        "properties": {}
    },
    {
        "type": "spawn",
        "x": 9108.28125,
        "y": 230,
        "width": 840,
        "height": 4260,
        "properties": {
            "spawnType": "mythic"
        }
    },
    {
        "type": "spawn",
        "x": 10088.28125,
        "y": 4210,
        "width": 1260,
        "height": 250,
        "properties": {
            "spawnType": "mythic"
        }
    },
    {
        "type": "spawn",
        "x": 10578.28125,
        "y": 380,
        "width": 450,
        "height": 3840,
        "properties": {
            "spawnType": "legendary"
        }
    },
    {
        "type": "spawn",
        "x": 10978.28125,
        "y": 610,
        "width": 1770,
        "height": 950,
        "properties": {
            "spawnType": "legendary"
        }
    },
    {
        "type": "spawn",
        "x": 12038.28125,
        "y": 1410,
        "width": 800,
        "height": 3000,
        "properties": {
            "spawnType": "legendary"
        }
    },
    {
        "type": "teleporter",
        "x": 528.28125,
        "y": 16240,
        "width": 550,
        "height": 510,
        "properties": {
            "teleportTo": {
                "x": 0,
                "y": 0,
                "serverPort": 3001
            }
        }
    },
    {
        "type": "teleporter",
        "x": 9928.28125,
        "y": 6200,
        "width": 980,
        "height": 560,
        "properties": {
            "teleportTo": {
                "x": 0,
                "y": 0,
                "serverPort": 3000
            }
        }
    },
    {
        "type": "teleporter",
        "x": 8828.28125,
        "y": 12000,
        "width": 860,
        "height": 650,
        "properties": {
            "teleportTo": {
                "x": 0,
                "y": 0,
                "serverPort": 3002
            }
        }
    }
];
// Add map validation function
function validateWorldMap(map) {
    // Check for required border walls
    const hasTopWall = map.some(el => el.type === 'wall' && el.y === 0 && el.width === exports.WORLD_WIDTH);
    const hasBottomWall = map.some(el => el.type === 'wall' && el.y === exports.WORLD_HEIGHT - 100);
    const hasLeftWall = map.some(el => el.type === 'wall' && el.x === 0);
    const hasRightWall = map.some(el => el.type === 'wall' && el.x === exports.WORLD_WIDTH - 100);
    if (!hasTopWall || !hasBottomWall || !hasLeftWall || !hasRightWall) {
        console.error('Map is missing border walls');
        return false;
    }
    // Check for at least one spawn point per tier
    const spawnTypes = map
        .filter(el => el.type === 'spawn')
        .map(el => el.properties?.spawnType)
        .filter((type) => type !== undefined);
    const requiredSpawnTypes = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
    const hasAllSpawnTypes = requiredSpawnTypes.every(type => spawnTypes.includes(type));
    if (!hasAllSpawnTypes) {
        console.error('Map is missing spawn points for some tiers');
        return false;
    }
    // Check for overlapping elements
    for (let i = 0; i < map.length; i++) {
        for (let j = i + 1; j < map.length; j++) {
            if (elementsOverlap(map[i], map[j])) {
                console.error('Map has overlapping elements:', map[i], map[j]);
                return false;
            }
        }
    }
    return true;
}
function elementsOverlap(a, b) {
    return !(a.x + a.width < b.x ||
        b.x + b.width < a.x ||
        a.y + a.height < b.y ||
        b.y + b.height < a.y);
}
// Add map element type guards
function isWall(element) {
    return element.type === 'wall';
}
function isSpawn(element) {
    return element.type === 'spawn';
}
function isTeleporter(element) {
    return element.type === 'teleporter';
}
function isSafeZone(element) {
    return element.type === 'safe_zone';
}
// Default server configuration - can be overridden via environment variables or config file
exports.DEFAULT_SERVER_CONFIGS = [
    { port: 3000, host: 'localhost', name: 'Server1' },
    { port: 3001, host: 'localhost', name: 'Server2' },
    { port: 3002, host: 'localhost', name: 'Server3' }
];
// Get server configuration from environment or use defaults
function getServerConfigs() {
    const configStr = process.env.SERVER_CONFIGS;
    if (configStr) {
        try {
            return JSON.parse(configStr);
        }
        catch (error) {
            console.error('Failed to parse SERVER_CONFIGS environment variable:', error);
        }
    }
    return exports.DEFAULT_SERVER_CONFIGS;
}
// Find server config by port
function getServerConfigByPort(port) {
    return getServerConfigs().find(config => config.port === port);
}
// Example cross-server teleporter configurations
// Add these to your WORLD_MAP array to test cross-server teleportation
exports.EXAMPLE_CROSS_SERVER_TELEPORTERS = [
    // Teleporter from Server 3000 to Server 3001
    {
        type: 'teleporter',
        x: 2000,
        y: 1000,
        width: 300,
        height: 300,
        properties: {
            teleportTo: {
                x: 800,
                y: 800,
                serverPort: 3001
            }
        }
    },
    // Teleporter from Server 3001 to Server 3002
    {
        type: 'teleporter',
        x: 1200,
        y: 1200,
        width: 300,
        height: 300,
        properties: {
            teleportTo: {
                x: 1500,
                y: 1500,
                serverPort: 3002
            }
        }
    },
    // Return teleporter from Server 3002 to Server 3000
    {
        type: 'teleporter',
        x: 1500,
        y: 2000,
        width: 300,
        height: 300,
        properties: {
            teleportTo: {
                x: 2000,
                y: 1000,
                serverPort: 3000
            }
        }
    }
];
