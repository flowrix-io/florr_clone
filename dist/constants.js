"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HEALTH_PER_LEVEL = exports.XP_MULTIPLIER = exports.BASE_XP_REQUIREMENT = exports.KNOCKBACK_RECOVERY_SPEED = exports.KNOCKBACK_FORCE = exports.MAX_SPEED = exports.RESPAWN_INVULNERABILITY_TIME = exports.MAX_INVENTORY_SIZE = exports.ENEMY_TIERS = exports.MAX_SAND_RADIUS = exports.MIN_SAND_RADIUS = exports.SAND_COUNT = exports.DECORATION_COUNT = exports.ENEMY_DAMAGE = exports.PLAYER_DAMAGE = exports.ENEMY_MAX_HEALTH = exports.PLAYER_MAX_HEALTH = exports.ENEMY_CORAL_DAMAGE = exports.ENEMY_CORAL_HEALTH = exports.ENEMY_CORAL_PROBABILITY = exports.OBSTACLE_COUNT = exports.SCALE_FACTOR = exports.PVP_WORLD_HEIGHT = exports.PVP_WORLD_WIDTH = exports.OLD_WORLD_HEIGHT = exports.OLD_WORLD_WIDTH = exports.ENEMIES_PER_VIEWPORT = exports.VIEWPORT_WITH_BUFFER_AREA = exports.ORIGINAL_ENEMY_DENSITY = exports.ORIGINAL_ENEMY_COUNT = exports.TOTAL_WORLD_AREA = exports.ACTUAL_WORLD_HEIGHT = exports.ACTUAL_WORLD_WIDTH = exports.WORLD_HEIGHT = exports.WORLD_WIDTH = exports.items = exports.obstacles = exports.enemies = exports.dots = exports.players = exports.VIEWPORT_AREA = exports.VIEWPORT_HEIGHT = exports.VIEWPORT_WIDTH = exports.ENEMY_DESPAWN_TIME = exports.VIEWPORT_BUFFER = exports.SERVER_PROTOCOL = exports.USE_HTTPS = exports.FISH_RETURN_SPEED = exports.PLAYER_BASE_SPEED = exports.FISH_DETECTION_RADIUS = void 0;
exports.EXAMPLE_CROSS_SERVER_TELEPORTERS = exports.DEFAULT_SERVER_CONFIGS = exports.WORLD_MAP = exports.MAZE_WALL_THICKNESS = exports.MAZE_CELL_SIZE = exports.DROP_CHANCES = exports.ENEMY_SIZE_MULTIPLIERS = exports.ZONE_BOUNDARIES = exports.ENEMY_SIZE = exports.PLAYER_SIZE = exports.DAMAGE_PER_LEVEL = void 0;
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
// Server protocol configuration
exports.USE_HTTPS = typeof process !== 'undefined' && process.env ? process.env.USE_HTTPS !== 'false' : true; // Default to HTTPS, set USE_HTTPS=false to use HTTP
exports.SERVER_PROTOCOL = exports.USE_HTTPS ? 'https' : 'http';
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
exports.WORLD_WIDTH = 60000;
exports.WORLD_HEIGHT = 60000;
exports.ACTUAL_WORLD_WIDTH = 60000;
exports.ACTUAL_WORLD_HEIGHT = 60000;
// Density calculation constants (defined after world dimensions)
exports.TOTAL_WORLD_AREA = exports.ACTUAL_WORLD_WIDTH * exports.ACTUAL_WORLD_HEIGHT; // 400,000,000 pixels²
exports.ORIGINAL_ENEMY_COUNT = 9000;
exports.ORIGINAL_ENEMY_DENSITY = exports.ORIGINAL_ENEMY_COUNT / exports.TOTAL_WORLD_AREA; // 0.0000225 enemies per pixel² (9x density)
exports.VIEWPORT_WITH_BUFFER_AREA = (exports.VIEWPORT_WIDTH + exports.VIEWPORT_BUFFER * 2) * (exports.VIEWPORT_HEIGHT + exports.VIEWPORT_BUFFER * 2); // 6,073,600 pixels²
exports.ENEMIES_PER_VIEWPORT = Math.ceil(exports.ORIGINAL_ENEMY_DENSITY * exports.VIEWPORT_WITH_BUFFER_AREA); // ~135 enemies per viewport (9x density)
exports.OLD_WORLD_WIDTH = 10000;
exports.OLD_WORLD_HEIGHT = 2000;
exports.PVP_WORLD_WIDTH = 30000;
exports.PVP_WORLD_HEIGHT = 30000;
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
    common: { start: 0, end: 12000 },
    uncommon: { start: 12000, end: 24000 },
    rare: { start: 24000, end: 36000 },
    epic: { start: 36000, end: 48000 },
    legendary: { start: 48000, end: 54000 },
    mythic: { start: 54000, end: exports.WORLD_WIDTH }
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
        "type": "biome",
        "x": 19768.28125,
        "y": 19840,
        "width": 0,
        "height": 0,
        "properties": {
            "biomeName": "swamp",
            "backgroundTexture": "background.svg",
            "spawnTable": [
                {
                    "tier": "common",
                    "weight": 1
                }
            ]
        }
    },
    {
        "type": "wall",
        "x": 18.4375,
        "y": 80,
        "width": 30,
        "height": 59910,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 48.4375,
        "y": 59990,
        "width": 0,
        "height": 0,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 38.4375,
        "y": 80,
        "width": 59890,
        "height": 50,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 59918.4375,
        "y": 110,
        "width": 50,
        "height": 59880,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 59968.4375,
        "y": 59990,
        "width": 0,
        "height": 0,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 48.4375,
        "y": 59930,
        "width": 59910,
        "height": 40,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 19808.4375,
        "y": 110,
        "width": 110,
        "height": 59820,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 48.4375,
        "y": 19930,
        "width": 59900,
        "height": 80,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 41225.3125,
        "y": 110,
        "width": 70,
        "height": 59860,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 41295.3125,
        "y": 59970,
        "width": 0,
        "height": 0,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 100.3125,
        "y": 36780.3125,
        "width": 59850,
        "height": 210,
        "properties": {}
    },
    {
        "type": "teleporter",
        "x": 16548.4375,
        "y": 9940,
        "width": 740,
        "height": 670,
        "properties": {
            "teleportTo": {
                "x": 20000,
                "y": 1000
            }
        }
    },
    {
        "type": "biome",
        "x": 19920,
        "y": 870,
        "width": 1210,
        "height": 1180,
        "properties": {
            "biomeName": "desert",
            "backgroundTexture": "desert.svg",
            "spawnTable": [
                {
                    "tier": "common",
                    "weight": 10,
                    "mobType": "cactus"
                }
            ]
        }
    },
    {
        "type": "teleporter",
        "x": 20968.4375,
        "y": 1000,
        "width": 150,
        "height": 150,
        "properties": {
            "teleportTo": {
                "x": 500,
                "y": 10000
            }
        }
    },
    {
        "type": "wall",
        "x": 19858.4375,
        "y": 2010,
        "width": 2180,
        "height": 110,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 19878.4375,
        "y": 830,
        "width": 2100,
        "height": 90,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 21918.4375,
        "y": 100,
        "width": 60,
        "height": 770,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 21068.4375,
        "y": 2100,
        "width": 90,
        "height": 1970,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 21118.4375,
        "y": 4030,
        "width": 4070,
        "height": 40,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 22608.4375,
        "y": 4080,
        "width": 50,
        "height": 2870,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 22428.4375,
        "y": 3960,
        "width": 480,
        "height": 380,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 24828.4375,
        "y": 1320,
        "width": 80,
        "height": 2740,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 23198.4375,
        "y": 1870,
        "width": 1660,
        "height": 110,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 25038.4375,
        "y": 4070,
        "width": 90,
        "height": 10620,
        "properties": {}
    },
    {
        "type": "biome",
        "x": 21130,
        "y": 940,
        "width": 2130,
        "height": 1080,
        "properties": {
            "biomeName": "desert",
            "backgroundTexture": "desert.svg",
            "spawnTable": [
                {
                    "tier": "common",
                    "weight": 5,
                    "mobType": "cactus"
                }
            ]
        }
    },
    {
        "type": "biome",
        "x": 21150,
        "y": 2070,
        "width": 2130,
        "height": 1970,
        "properties": {
            "biomeName": "desert",
            "backgroundTexture": "desert.svg",
            "spawnTable": [
                {
                    "tier": "common",
                    "weight": 10,
                    "mobType": "shiny_ladybug"
                }
            ]
        }
    },
    {
        "type": "biome",
        "x": 23290,
        "y": 2090,
        "width": 1570,
        "height": 1940,
        "properties": {
            "biomeName": "desert",
            "backgroundTexture": "desert.svg",
            "spawnTable": [
                {
                    "tier": "common",
                    "weight": 10,
                    "mobType": "sandstorm"
                }
            ]
        }
    },
    {
        "type": "biome",
        "x": 21980,
        "y": 140,
        "width": 2950,
        "height": 790,
        "properties": {
            "biomeName": "desert",
            "backgroundTexture": "desert.svg",
            "spawnTable": [
                {
                    "tier": "uncommon",
                    "weight": 3,
                    "mobType": "beetle"
                }
            ]
        }
    },
    {
        "type": "biome",
        "x": 23280,
        "y": 890,
        "width": 1570,
        "height": 990,
        "properties": {
            "biomeName": "desert",
            "backgroundTexture": "desert.svg",
            "spawnTable": [
                {
                    "tier": "uncommon",
                    "weight": 3,
                    "mobType": "beetle"
                }
            ]
        }
    },
    {
        "type": "biome",
        "x": 24850,
        "y": 130,
        "width": 2540,
        "height": 1190,
        "properties": {
            "biomeName": "desert",
            "backgroundTexture": "desert.svg",
            "spawnTable": [
                {
                    "tier": "uncommon",
                    "weight": 3,
                    "mobType": "beetle"
                }
            ]
        }
    },
    {
        "type": "biome",
        "x": 24910,
        "y": 1340,
        "width": 3010,
        "height": 2690,
        "properties": {
            "biomeName": "desert",
            "backgroundTexture": "desert.svg",
            "spawnTable": [
                {
                    "tier": "rare",
                    "weight": 3,
                    "mobType": "beetle"
                }
            ]
        }
    },
    {
        "type": "biome",
        "x": 27410,
        "y": 110,
        "width": 3390,
        "height": 1270,
        "properties": {
            "biomeName": "desert",
            "backgroundTexture": "desert.svg",
            "spawnTable": [
                {
                    "tier": "rare",
                    "weight": 3,
                    "mobType": "beetle"
                }
            ]
        }
    },
    {
        "type": "wall",
        "x": 27068.4375,
        "y": 940,
        "width": 80,
        "height": 2800,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 27108.4375,
        "y": 3690,
        "width": 2200,
        "height": 60,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 28478.4375,
        "y": 3720,
        "width": 70,
        "height": 3790,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 27348.4375,
        "y": 3730,
        "width": 250,
        "height": 3850,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 25778.4375,
        "y": 4880,
        "width": 1620,
        "height": 340,
        "properties": {}
    },
    {
        "type": "biome",
        "x": 27890,
        "y": 1350,
        "width": 2350,
        "height": 2350,
        "properties": {
            "biomeName": "desert",
            "backgroundTexture": "desert.svg",
            "spawnTable": [
                {
                    "tier": "rare",
                    "weight": 3,
                    "mobType": "beetle"
                }
            ]
        }
    },
    {
        "type": "biome",
        "x": 25180,
        "y": 4060,
        "width": 2180,
        "height": 830,
        "properties": {
            "biomeName": "desert",
            "backgroundTexture": "desert.svg",
            "spawnTable": [
                {
                    "tier": "rare",
                    "weight": 3,
                    "mobType": "beetle"
                }
            ]
        }
    },
    {
        "type": "biome",
        "x": 25100,
        "y": 4910,
        "width": 2270,
        "height": 4380,
        "properties": {
            "biomeName": "desert",
            "backgroundTexture": "desert.svg",
            "spawnTable": [
                {
                    "tier": "rare",
                    "weight": 3,
                    "mobType": "beetle"
                }
            ]
        }
    },
    {
        "type": "biome",
        "x": 28540,
        "y": 3770,
        "width": 2490,
        "height": 4090,
        "properties": {
            "biomeName": "desert",
            "backgroundTexture": "desert.svg",
            "spawnTable": [
                {
                    "tier": "legendary",
                    "weight": 3,
                    "mobType": "beetle"
                }
            ]
        }
    },
    {
        "type": "biome",
        "x": 27570,
        "y": 4070,
        "width": 920,
        "height": 5450,
        "properties": {
            "biomeName": "desert",
            "backgroundTexture": "desert.svg",
            "spawnTable": [
                {
                    "tier": "legendary",
                    "weight": 3,
                    "mobType": "beetle"
                }
            ]
        }
    },
    {
        "type": "biome",
        "x": 28450,
        "y": 7820,
        "width": 4010,
        "height": 1700,
        "properties": {
            "biomeName": "desert",
            "backgroundTexture": "desert.svg",
            "spawnTable": [
                {
                    "tier": "legendary",
                    "weight": 3,
                    "mobType": "beetle"
                }
            ]
        }
    },
    {
        "type": "wall",
        "x": 29388.4375,
        "y": 5270,
        "width": 2470,
        "height": 40,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 30438.4375,
        "y": 4230,
        "width": 80,
        "height": 2370,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 31538.4375,
        "y": 2740,
        "width": 60,
        "height": 2540,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 30518.4375,
        "y": 3440,
        "width": 1050,
        "height": 60,
        "properties": {}
    },
    {
        "type": "biome",
        "x": 30980,
        "y": 4420,
        "width": 540,
        "height": 460,
        "properties": {
            "biomeName": "desert",
            "backgroundTexture": "desert.svg",
            "spawnTable": [
                {
                    "tier": "legendary",
                    "weight": 3,
                    "mobType": "beetle"
                }
            ]
        }
    },
    {
        "type": "wall",
        "x": 31578.4375,
        "y": 3720,
        "width": 8790,
        "height": 100,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 36798.4375,
        "y": 3790,
        "width": 100,
        "height": 3040,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 36878.4375,
        "y": 6000,
        "width": 1600,
        "height": 100,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 37598.4375,
        "y": 5710,
        "width": 130,
        "height": 2230,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 35928.4375,
        "y": 6510,
        "width": 1490,
        "height": 50,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 37688.4375,
        "y": 7850,
        "width": 160,
        "height": 6950,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 27718.4375,
        "y": 12030,
        "width": 7030,
        "height": 90,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 34608.4375,
        "y": 12110,
        "width": 80,
        "height": 5260,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 34718.4375,
        "y": 13660,
        "width": 1490,
        "height": 90,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 34068.4375,
        "y": 7680,
        "width": 250,
        "height": 300,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 33058.4375,
        "y": 9220,
        "width": 210,
        "height": 180,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 35308.4375,
        "y": 9030,
        "width": 260,
        "height": 250,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 27188.4375,
        "y": 10550,
        "width": 250,
        "height": 220,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 27088.4375,
        "y": 14930,
        "width": 200,
        "height": 210,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 31158.4375,
        "y": 13380,
        "width": 220,
        "height": 200,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 29958.4375,
        "y": 15710,
        "width": 220,
        "height": 260,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 29128.4375,
        "y": 13530,
        "width": 260,
        "height": 310,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 31528.4375,
        "y": 15130,
        "width": 230,
        "height": 330,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 32468.4375,
        "y": 13660,
        "width": 590,
        "height": 470,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 30948.4375,
        "y": 16720,
        "width": 190,
        "height": 290,
        "properties": {}
    },
    {
        "type": "biome",
        "x": 25090,
        "y": 12150,
        "width": 9550,
        "height": 7810,
        "properties": {
            "biomeName": "desert",
            "backgroundTexture": "desert.svg",
            "spawnTable": [
                {
                    "tier": "mythic",
                    "weight": 2,
                    "mobType": "beetle"
                }
            ]
        }
    },
    {
        "type": "biome",
        "x": 25090,
        "y": 9570,
        "width": 12660,
        "height": 2490,
        "properties": {
            "biomeName": "desert",
            "backgroundTexture": "desert.svg",
            "spawnTable": [
                {
                    "tier": "mythic",
                    "weight": 2,
                    "mobType": "beetle"
                }
            ]
        }
    },
    {
        "type": "biome",
        "x": 41270,
        "y": 130,
        "width": 18680,
        "height": 19820,
        "properties": {
            "biomeName": "hel",
            "backgroundTexture": "hel.svg",
            "spawnTable": [
                {
                    "tier": "mythic",
                    "weight": 10,
                    "mobType": "hel_beetle"
                }
            ]
        }
    },
    {
        "type": "teleporter",
        "x": 31058.4375,
        "y": 490,
        "width": 160,
        "height": 160,
        "properties": {
            "teleportTo": {
                "x": 50000,
                "y": 1000
            }
        }
    },
    {
        "type": "wall",
        "x": 27538.3984375,
        "y": 20007.5,
        "width": 80,
        "height": 6040,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 27588.3984375,
        "y": 25267.5,
        "width": 6420,
        "height": 180,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 23548.3984375,
        "y": 30627.5,
        "width": 10110,
        "height": 220,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 23588.3984375,
        "y": 30787.5,
        "width": 140,
        "height": 4140,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 33478.3984375,
        "y": 25340,
        "width": 130,
        "height": 2060,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 33338.3984375,
        "y": 28500,
        "width": 140,
        "height": 2150,
        "properties": {}
    },
    {
        "type": "biome",
        "x": 19902.65625,
        "y": 20010,
        "width": 4220,
        "height": 3040,
        "properties": {
            "biomeName": "ant_hell",
            "backgroundTexture": "ant_hell.svg",
            "spawnTable": [
                {
                    "tier": "common",
                    "weight": 10,
                    "mobType": "soldier_ant"
                }
            ]
        }
    },
    {
        "type": "biome",
        "x": 24122.65625,
        "y": 20000,
        "width": 3420,
        "height": 3480,
        "properties": {
            "biomeName": "ant_hell",
            "backgroundTexture": "ant_hell.svg",
            "spawnTable": [
                {
                    "tier": "uncommon",
                    "weight": 10,
                    "mobType": "soldier_ant"
                }
            ]
        }
    },
    {
        "type": "biome",
        "x": 19892.65625,
        "y": 23090,
        "width": 7680,
        "height": 2960,
        "properties": {
            "biomeName": "ant_hell",
            "backgroundTexture": "ant_hell.svg",
            "spawnTable": [
                {
                    "tier": "uncommon",
                    "weight": 10,
                    "mobType": "soldier_ant"
                }
            ]
        }
    },
    {
        "type": "biome",
        "x": 19902.65625,
        "y": 26080,
        "width": 2420,
        "height": 4530,
        "properties": {
            "biomeName": "ant_hell",
            "backgroundTexture": "ant_hell.svg",
            "spawnTable": [
                {
                    "tier": "rare",
                    "weight": 10,
                    "mobType": "soldier_ant"
                }
            ]
        }
    },
    {
        "type": "biome",
        "x": 22282.65625,
        "y": 26100,
        "width": 5930,
        "height": 450,
        "properties": {
            "biomeName": "ant_hell",
            "backgroundTexture": "ant_hell.svg",
            "spawnTable": [
                {
                    "tier": "rare",
                    "weight": 10,
                    "mobType": "soldier_ant"
                }
            ]
        }
    },
    {
        "type": "biome",
        "x": 27822.65625,
        "y": 25400,
        "width": 540,
        "height": 720,
        "properties": {
            "biomeName": "ant_hell",
            "backgroundTexture": "ant_hell.svg",
            "spawnTable": [
                {
                    "tier": "rare",
                    "weight": 10,
                    "mobType": "soldier_ant"
                }
            ]
        }
    },
    {
        "type": "biome",
        "x": 22322.65625,
        "y": 26592.5,
        "width": 1280,
        "height": 4750,
        "properties": {
            "biomeName": "ant_hell",
            "backgroundTexture": "ant_hell.svg",
            "spawnTable": [
                {
                    "tier": "epic",
                    "weight": 10,
                    "mobType": "soldier_ant"
                }
            ]
        }
    },
    {
        "type": "biome",
        "x": 22342.65625,
        "y": 26582.5,
        "width": 6620,
        "height": 370,
        "properties": {
            "biomeName": "ant_hell",
            "backgroundTexture": "ant_hell.svg",
            "spawnTable": [
                {
                    "tier": "epic",
                    "weight": 10,
                    "mobType": "soldier_ant"
                }
            ]
        }
    },
    {
        "type": "biome",
        "x": 27632.65625,
        "y": 25432.5,
        "width": 180,
        "height": 650,
        "properties": {
            "biomeName": "ant_hell",
            "backgroundTexture": "ant_hell.svg",
            "spawnTable": [
                {
                    "tier": "epic",
                    "weight": 10,
                    "mobType": "soldier_ant"
                }
            ]
        }
    },
    {
        "type": "biome",
        "x": 28262.65625,
        "y": 26132.5,
        "width": 730,
        "height": 490,
        "properties": {
            "biomeName": "ant_hell",
            "backgroundTexture": "ant_hell.svg",
            "spawnTable": [
                {
                    "tier": "epic",
                    "weight": 10,
                    "mobType": "soldier_ant"
                }
            ]
        }
    },
    {
        "type": "biome",
        "x": 28390,
        "y": 25430,
        "width": 5140,
        "height": 730,
        "properties": {
            "biomeName": "ant_hell",
            "backgroundTexture": "ant_hell.svg",
            "spawnTable": [
                {
                    "tier": "epic",
                    "weight": 10,
                    "mobType": "soldier_ant"
                }
            ]
        }
    },
    {
        "type": "biome",
        "x": 23620,
        "y": 26980,
        "width": 5200,
        "height": 3710,
        "properties": {
            "biomeName": "ant_hell",
            "backgroundTexture": "ant_hell.svg",
            "spawnTable": [
                {
                    "tier": "legendary",
                    "weight": 10,
                    "mobType": "soldier_ant"
                }
            ]
        }
    },
    {
        "type": "biome",
        "x": 28830,
        "y": 26990,
        "width": 4560,
        "height": 3690,
        "properties": {
            "biomeName": "ant_hell",
            "backgroundTexture": "ant_hell.svg",
            "spawnTable": [
                {
                    "tier": "mythic",
                    "weight": 10,
                    "mobType": "soldier_ant"
                }
            ]
        }
    },
    {
        "type": "biome",
        "x": 29020,
        "y": 26170,
        "width": 4510,
        "height": 850,
        "properties": {
            "biomeName": "ant_hell",
            "backgroundTexture": "ant_hell.svg",
            "spawnTable": [
                {
                    "tier": "mythic",
                    "weight": 10,
                    "mobType": "soldier_ant"
                }
            ]
        }
    },
    {
        "type": "biome",
        "x": 27600,
        "y": 20000,
        "width": 6300,
        "height": 5300,
        "properties": {
            "biomeName": "ant_hell",
            "backgroundTexture": "ant_hell.svg",
            "spawnTable": [
                {
                    "tier": "mythic",
                    "weight": 10,
                    "mobType": "soldier_fire_ant"
                }
            ]
        }
    },
    {
        "type": "biome",
        "x": 33911.99951171875,
        "y": 20004.000244140625,
        "width": 7330,
        "height": 5300,
        "properties": {
            "biomeName": "ant_hell",
            "backgroundTexture": "ant_hell.svg",
            "spawnTable": [
                {
                    "tier": "legendary",
                    "weight": 10,
                    "mobType": "soldier_fire_ant"
                }
            ]
        }
    },
    {
        "type": "biome",
        "x": 19892.000732421875,
        "y": 30640,
        "width": 2420,
        "height": 1740,
        "properties": {
            "biomeName": "ant_hell",
            "backgroundTexture": "ant_hell.svg",
            "spawnTable": [
                {
                    "tier": "legendary",
                    "weight": 10,
                    "mobType": "soldier_fire_ant"
                }
            ]
        }
    },
    {
        "type": "biome",
        "x": 22222.000732421875,
        "y": 31360,
        "width": 1390,
        "height": 3630,
        "properties": {
            "biomeName": "ant_hell",
            "backgroundTexture": "ant_hell.svg",
            "spawnTable": [
                {
                    "tier": "legendary",
                    "weight": 10,
                    "mobType": "soldier_fire_ant"
                }
            ]
        }
    },
    {
        "type": "biome",
        "x": 19852.000732421875,
        "y": 32370,
        "width": 2510,
        "height": 2620,
        "properties": {
            "biomeName": "ant_hell",
            "backgroundTexture": "ant_hell.svg",
            "spawnTable": [
                {
                    "tier": "legendary",
                    "weight": 10,
                    "mobType": "soldier_fire_ant"
                }
            ]
        }
    },
    {
        "type": "biome",
        "x": 19902.000732421875,
        "y": 34971.99951171875,
        "width": 8470,
        "height": 1830,
        "properties": {
            "biomeName": "ant_hell",
            "backgroundTexture": "ant_hell.svg",
            "spawnTable": [
                {
                    "tier": "legendary",
                    "weight": 10,
                    "mobType": "soldier_fire_ant"
                }
            ]
        }
    },
    {
        "type": "biome",
        "x": 23712.000732421875,
        "y": 30831.99951171875,
        "width": 6139.998779296875,
        "height": 4130,
        "properties": {
            "biomeName": "ant_hell",
            "backgroundTexture": "ant_hell.svg",
            "spawnTable": [
                {
                    "tier": "epic",
                    "weight": 10,
                    "mobType": "soldier_fire_ant"
                }
            ]
        }
    },
    {
        "type": "biome",
        "x": 28381.99951171875,
        "y": 34990,
        "width": 2960,
        "height": 1810,
        "properties": {
            "biomeName": "ant_hell",
            "backgroundTexture": "ant_hell.svg",
            "spawnTable": [
                {
                    "tier": "rare",
                    "weight": 10,
                    "mobType": "soldier_fire_ant"
                }
            ]
        }
    },
    {
        "type": "biome",
        "x": 29871.99951171875,
        "y": 30846.0009765625,
        "width": 4490,
        "height": 4180,
        "properties": {
            "biomeName": "ant_hell",
            "backgroundTexture": "ant_hell.svg",
            "spawnTable": [
                {
                    "tier": "rare",
                    "weight": 10,
                    "mobType": "soldier_fire_ant"
                }
            ]
        }
    },
    {
        "type": "biome",
        "x": 31351.99951171875,
        "y": 35054.00146484375,
        "width": 9890,
        "height": 1760,
        "properties": {
            "biomeName": "ant_hell",
            "backgroundTexture": "ant_hell.svg",
            "spawnTable": [
                {
                    "tier": "uncommon",
                    "weight": 10,
                    "mobType": "soldier_fire_ant"
                }
            ]
        }
    },
    {
        "type": "biome",
        "x": 34381.99951171875,
        "y": 30871.99951171875,
        "width": 6860,
        "height": 4120,
        "properties": {
            "biomeName": "ant_hell",
            "backgroundTexture": "ant_hell.svg",
            "spawnTable": [
                {
                    "tier": "common",
                    "weight": 10,
                    "mobType": "soldier_fire_ant"
                }
            ]
        }
    },
    {
        "type": "biome",
        "x": 33611.99951171875,
        "y": 25351.99951171875,
        "width": 7630,
        "height": 2680,
        "properties": {
            "biomeName": "ant_hell",
            "backgroundTexture": "ant_hell.svg",
            "spawnTable": [
                {
                    "tier": "epic",
                    "weight": 10,
                    "mobType": "soldier_fire_ant"
                }
            ]
        }
    },
    {
        "type": "biome",
        "x": 33401.99951171875,
        "y": 28056.0009765625,
        "width": 7850,
        "height": 1520,
        "properties": {
            "biomeName": "ant_hell",
            "backgroundTexture": "ant_hell.svg",
            "spawnTable": [
                {
                    "tier": "rare",
                    "weight": 10,
                    "mobType": "soldier_fire_ant"
                }
            ]
        }
    },
    {
        "type": "biome",
        "x": 33451.99951171875,
        "y": 29594.00146484375,
        "width": 7800,
        "height": 1220,
        "properties": {
            "biomeName": "ant_hell",
            "backgroundTexture": "ant_hell.svg",
            "spawnTable": [
                {
                    "tier": "uncommon",
                    "weight": 10,
                    "mobType": "soldier_fire_ant"
                }
            ]
        }
    },
    {
        "type": "teleporter",
        "x": 10143.068237304688,
        "y": 6169.090881347656,
        "width": 460,
        "height": 420,
        "properties": {
            "teleportTo": {
                "x": 21000,
                "y": 21000
            }
        }
    },
    {
        "type": "teleporter",
        "x": 21969.765625,
        "y": 1355.078125,
        "width": 160,
        "height": 150,
        "properties": {
            "teleportTo": {
                "x": 35500,
                "y": 30000
            }
        }
    },
    {
        "type": "biome",
        "x": 40,
        "y": 20010,
        "width": 3350,
        "height": 4030,
        "properties": {
            "biomeName": "ocean",
            "backgroundTexture": "ocean.svg",
            "spawnTable": [
                {
                    "tier": "common",
                    "weight": 3,
                    "mobType": "jellyfish"
                }
            ]
        }
    },
    {
        "type": "biome",
        "x": 3380,
        "y": 20010,
        "width": 2440,
        "height": 2300,
        "properties": {
            "biomeName": "ocean",
            "backgroundTexture": "ocean.svg",
            "spawnTable": [
                {
                    "tier": "uncommon",
                    "weight": 3,
                    "mobType": "jellyfish"
                }
            ]
        }
    },
    {
        "type": "wall",
        "x": 38.4375,
        "y": 23990,
        "width": 3450,
        "height": 160,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 3328.4375,
        "y": 22180,
        "width": 110,
        "height": 1870,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 3398.4375,
        "y": 22200,
        "width": 7920,
        "height": 130,
        "properties": {}
    },
    {
        "type": "biome",
        "x": 5810,
        "y": 20010,
        "width": 4870,
        "height": 2200,
        "properties": {
            "biomeName": "ocean",
            "backgroundTexture": "ocean.svg",
            "spawnTable": [
                {
                    "tier": "rare",
                    "weight": 3,
                    "mobType": "jellyfish"
                }
            ]
        }
    },
    {
        "type": "biome",
        "x": 10660,
        "y": 20010,
        "width": 9180,
        "height": 2260,
        "properties": {
            "biomeName": "ocean",
            "backgroundTexture": "ocean.svg",
            "spawnTable": [
                {
                    "tier": "epic",
                    "weight": 3,
                    "mobType": "jellyfish"
                }
            ]
        }
    },
    {
        "type": "biome",
        "x": 11310,
        "y": 22250,
        "width": 8520,
        "height": 5230,
        "properties": {
            "biomeName": "ocean",
            "backgroundTexture": "ocean.svg",
            "spawnTable": [
                {
                    "tier": "legendary",
                    "weight": 3,
                    "mobType": "jellyfish"
                }
            ]
        }
    },
    {
        "type": "wall",
        "x": 11328.4375,
        "y": 27430,
        "width": 0,
        "height": 0,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 11298.4375,
        "y": 27400,
        "width": 8550,
        "height": 150,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 11248.4375,
        "y": 22250,
        "width": 130,
        "height": 3040,
        "properties": {}
    },
    {
        "type": "biome",
        "x": 3430,
        "y": 22320,
        "width": 7880,
        "height": 5950,
        "properties": {
            "biomeName": "ocean",
            "backgroundTexture": "ocean.svg",
            "spawnTable": [
                {
                    "tier": "mythic",
                    "weight": 3,
                    "mobType": "jellyfish"
                }
            ]
        }
    },
    {
        "type": "biome",
        "x": 40,
        "y": 24140,
        "width": 3390,
        "height": 9470,
        "properties": {
            "biomeName": "ocean",
            "backgroundTexture": "ocean.svg",
            "spawnTable": [
                {
                    "tier": "mythic",
                    "weight": 10,
                    "mobType": "jellyfish"
                }
            ]
        }
    },
    {
        "type": "biome",
        "x": 3420,
        "y": 28250,
        "width": 7270,
        "height": 7280,
        "properties": {
            "biomeName": "ocean",
            "backgroundTexture": "ocean.svg",
            "spawnTable": [
                {
                    "tier": "ultra",
                    "weight": 3,
                    "mobType": "bubble"
                }
            ]
        }
    },
    {
        "type": "biome",
        "x": 410,
        "y": 33600,
        "width": 10,
        "height": 20,
        "properties": {
            "biomeName": "ocean",
            "backgroundTexture": "ocean.svg",
            "spawnTable": [
                {
                    "tier": "ultra",
                    "weight": 3,
                    "mobType": "bubble"
                }
            ]
        }
    },
    {
        "type": "biome",
        "x": 40,
        "y": 33610,
        "width": 3420,
        "height": 3210,
        "properties": {
            "biomeName": "ocean",
            "backgroundTexture": "ocean.svg",
            "spawnTable": [
                {
                    "tier": "ultra",
                    "weight": 3,
                    "mobType": "bubble"
                }
            ]
        }
    },
    {
        "type": "wall",
        "x": 38.4375,
        "y": 36800,
        "width": 400,
        "height": 200,
        "properties": {}
    },
    {
        "type": "biome",
        "x": 3440,
        "y": 35520,
        "width": 16380,
        "height": 1290,
        "properties": {
            "biomeName": "ocean",
            "backgroundTexture": "ocean.svg",
            "spawnTable": [
                {
                    "tier": "ultra",
                    "weight": 3,
                    "mobType": "bubble"
                }
            ]
        }
    },
    {
        "type": "biome",
        "x": 10680,
        "y": 28240,
        "width": 9130,
        "height": 7280,
        "properties": {
            "biomeName": "ocean",
            "backgroundTexture": "ocean.svg",
            "spawnTable": [
                {
                    "tier": "ultra",
                    "weight": 3,
                    "mobType": "bubble"
                }
            ]
        }
    },
    {
        "type": "biome",
        "x": 11290,
        "y": 27530,
        "width": 8530,
        "height": 730,
        "properties": {
            "biomeName": "ocean",
            "backgroundTexture": "ocean.svg",
            "spawnTable": [
                {
                    "tier": "ultra",
                    "weight": 3,
                    "mobType": "bubble"
                }
            ]
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
    const configStr = typeof process !== 'undefined' && process.env ? process.env.SERVER_CONFIGS : undefined;
    if (configStr) {
        try {
            const configs = JSON.parse(configStr);
            return configs.map((config) => ({
                ...config,
                protocol: config.protocol || exports.SERVER_PROTOCOL
            }));
        }
        catch (error) {
            console.error('Failed to parse SERVER_CONFIGS environment variable:', error);
        }
    }
    return exports.DEFAULT_SERVER_CONFIGS.map(config => ({
        ...config,
        protocol: config.protocol || exports.SERVER_PROTOCOL
    }));
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
