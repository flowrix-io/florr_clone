"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WORLD_MAP = exports.MAZE_WALL_THICKNESS = exports.MAZE_CELL_SIZE = exports.DROP_CHANCES = exports.ENEMY_SIZE_MULTIPLIERS = exports.ZONE_BOUNDARIES = exports.ENEMY_SIZE = exports.PLAYER_SIZE = exports.DAMAGE_PER_LEVEL = exports.HEALTH_PER_LEVEL = exports.XP_MULTIPLIER = exports.BASE_XP_REQUIREMENT = exports.KNOCKBACK_RECOVERY_SPEED = exports.KNOCKBACK_FORCE = exports.RESPAWN_INVULNERABILITY_TIME = exports.MAX_INVENTORY_SIZE = exports.ENEMY_TIERS = exports.MAX_SAND_RADIUS = exports.MIN_SAND_RADIUS = exports.SAND_COUNT = exports.DECORATION_COUNT = exports.ENEMY_DAMAGE = exports.PLAYER_DAMAGE = exports.ENEMY_MAX_HEALTH = exports.PLAYER_MAX_HEALTH = exports.ENEMY_CORAL_DAMAGE = exports.ENEMY_CORAL_HEALTH = exports.ENEMY_CORAL_PROBABILITY = exports.OBSTACLE_COUNT = exports.SCALE_FACTOR = exports.ACTUAL_WORLD_HEIGHT = exports.ACTUAL_WORLD_WIDTH = exports.WORLD_HEIGHT = exports.WORLD_WIDTH = exports.items = exports.obstacles = exports.enemies = exports.dots = exports.players = exports.FISH_RETURN_SPEED = exports.PLAYER_BASE_SPEED = exports.FISH_DETECTION_RADIUS = void 0;
exports.validateWorldMap = validateWorldMap;
exports.isWall = isWall;
exports.isSpawn = isSpawn;
exports.isTeleporter = isTeleporter;
exports.isSafeZone = isSafeZone;
// Add these constants at the top with the others
exports.FISH_DETECTION_RADIUS = 500; // How far fish can detect players
exports.PLAYER_BASE_SPEED = 5; // Base player speed to match
exports.FISH_RETURN_SPEED = 0.5; // Speed at which fish return to their normal behavior
exports.players = {};
exports.dots = [];
exports.enemies = [];
exports.obstacles = [];
exports.items = [];
exports.WORLD_WIDTH = 20000;
exports.WORLD_HEIGHT = 20000;
exports.ACTUAL_WORLD_WIDTH = 20000;
exports.ACTUAL_WORLD_HEIGHT = 20000;
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
    common: { health: 5, speed: 0.5, damage: 5, probability: 0.4, color: '#808080' },
    uncommon: { health: 40, speed: 0.75, damage: 10, probability: 0.3, color: '#008000' },
    rare: { health: 60, speed: 1, damage: 15, probability: 0.15, color: '#0000FF' },
    epic: { health: 80, speed: 1.25, damage: 20, probability: 0.1, color: '#800080' },
    legendary: { health: 100, speed: 1.5, damage: 25, probability: 0.04, color: '#FFA500' },
    mythic: { health: 150, speed: 2, damage: 30, probability: 0.01, color: '#FF0000' }
};
exports.MAX_INVENTORY_SIZE = 5;
exports.RESPAWN_INVULNERABILITY_TIME = 3000; // 3 seconds of invulnerability after respawn
// Add knockback constants at the top with other constants
exports.KNOCKBACK_FORCE = 20; // Increased from 20 to 100
exports.KNOCKBACK_RECOVERY_SPEED = 0.9; // How quickly the knockback effect diminishes
// Add XP-related constants
exports.BASE_XP_REQUIREMENT = 100;
exports.XP_MULTIPLIER = 1.5;
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
    mythic: 2.0
};
// Add drop chances like in singleplayer
exports.DROP_CHANCES = {
    common: 1, // 10% chance
    uncommon: 1, // 20% chance
    rare: 1, // 30% chance
    epic: 1, // 40% chance
    legendary: 1, // 50% chance
    mythic: 1 // 75% chance
};
// Add maze configuration
exports.MAZE_CELL_SIZE = 1000; // Size of each maze cell
exports.MAZE_WALL_THICKNESS = 100; // Thickness of maze walls
// Define the permanent map layout
exports.WORLD_MAP = [
    {
        "type": "wall",
        "x": 6.5625,
        "y": 9500,
        "width": 2990,
        "height": 340,
        "properties": {}
    },
    {
        "type": "wall",
        "x": -13.4375,
        "y": 11370,
        "width": 3040,
        "height": 410,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 3006.5625,
        "y": 9530,
        "width": 590,
        "height": 1250,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 2596.5625,
        "y": 9220,
        "width": 720,
        "height": 610,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 3616.5625,
        "y": 10640,
        "width": 550,
        "height": 740,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 3416.5625,
        "y": 10410,
        "width": 460,
        "height": 340,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 3856.5625,
        "y": 11300,
        "width": 940,
        "height": 2180,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 886.5625,
        "y": 11740,
        "width": 670,
        "height": 980,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 6.5625,
        "y": 14450,
        "width": 2100,
        "height": 370,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 3626.5625,
        "y": 14640,
        "width": 800,
        "height": 280,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 4256.5625,
        "y": 14810,
        "width": 640,
        "height": 790,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 3936.5625,
        "y": 14900,
        "width": 390,
        "height": 390,
        "properties": {}
    },
    {
        "type": "spawn",
        "x": 1036.5625,
        "y": 15660,
        "width": 1910,
        "height": 1310,
        "properties": {
            "spawnType": "common"
        }
    },
    {
        "type": "teleporter",
        "x": 3936.5625,
        "y": 16110,
        "width": 680,
        "height": 430,
        "properties": {
            "teleportTo": {
                "x": 0,
                "y": 0
            }
        }
    },
    {
        "type": "wall",
        "x": 16.5625,
        "y": 17170,
        "width": 2720,
        "height": 500,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 2616.5625,
        "y": 17490,
        "width": 2460,
        "height": 520,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 4916.5625,
        "y": 17710,
        "width": 9410,
        "height": 830,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 14216.5625,
        "y": 18150,
        "width": 4330,
        "height": 350,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 3336.5625,
        "y": 18820,
        "width": 8230,
        "height": 460,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 11506.5625,
        "y": 19100,
        "width": 8480,
        "height": 160,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 19986.5625,
        "y": 19260,
        "width": 0,
        "height": 0,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 1986.5625,
        "y": 18340,
        "width": 1450,
        "height": 640,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 1306.5625,
        "y": 18080,
        "width": 860,
        "height": 380,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 806.5625,
        "y": 18330,
        "width": 850,
        "height": 260,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 1296.5625,
        "y": 18570,
        "width": 1040,
        "height": 410,
        "properties": {}
    },
    {
        "type": "spawn",
        "x": 16616.5625,
        "y": 19270,
        "width": 3300,
        "height": 720,
        "properties": {
            "spawnType": "rare"
        }
    },
    {
        "type": "spawn",
        "x": 19916.5625,
        "y": 19990,
        "width": 0,
        "height": 0,
        "properties": {
            "spawnType": "rare"
        }
    },
    {
        "type": "spawn",
        "x": 386.5625,
        "y": 19180,
        "width": 2690,
        "height": 780,
        "properties": {
            "spawnType": "mythic"
        }
    },
    {
        "type": "spawn",
        "x": 2986.5625,
        "y": 17850,
        "width": 7750,
        "height": 1040,
        "properties": {
            "spawnType": "legendary"
        }
    },
    {
        "type": "spawn",
        "x": 12086.5625,
        "y": 18480,
        "width": 6740,
        "height": 650,
        "properties": {
            "spawnType": "epic"
        }
    },
    {
        "type": "wall",
        "x": 4746.5625,
        "y": 13110,
        "width": 3150,
        "height": 940,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 7786.5625,
        "y": 13630,
        "width": 1190,
        "height": 1340,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 6156.5625,
        "y": 15590,
        "width": 360,
        "height": 2140,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 8516.5625,
        "y": 14990,
        "width": 1310,
        "height": 1100,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 8786.5625,
        "y": 14770,
        "width": 2120,
        "height": 1120,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 12206.5625,
        "y": 15510,
        "width": 3070,
        "height": 650,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 13356.5625,
        "y": 11560,
        "width": 920,
        "height": 4020,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 13996.5625,
        "y": 5290,
        "width": 580,
        "height": 6330,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 14816.5625,
        "y": 16120,
        "width": 3820,
        "height": 360,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 17646.5625,
        "y": 16470,
        "width": 1620,
        "height": 720,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 15426.5625,
        "y": 13850,
        "width": 800,
        "height": 370,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 15936.5625,
        "y": 13800,
        "width": 480,
        "height": 130,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 15456.5625,
        "y": 14130,
        "width": 320,
        "height": 240,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 18126.5625,
        "y": 13930,
        "width": 870,
        "height": 240,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 18296.5625,
        "y": 13820,
        "width": 460,
        "height": 230,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 16556.5625,
        "y": 11650,
        "width": 1090,
        "height": 310,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 16896.5625,
        "y": 11860,
        "width": 340,
        "height": 300,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 16396.5625,
        "y": 11540,
        "width": 480,
        "height": 200,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 17506.5625,
        "y": 9440,
        "width": 1350,
        "height": 340,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 17936.5625,
        "y": 9730,
        "width": 400,
        "height": 410,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 15096.5625,
        "y": 8910,
        "width": 820,
        "height": 410,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 15376.5625,
        "y": 9270,
        "width": 310,
        "height": 300,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 15846.5625,
        "y": 9170,
        "width": 490,
        "height": 280,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 15966.5625,
        "y": 7310,
        "width": 870,
        "height": 380,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 16346.5625,
        "y": 7650,
        "width": 100,
        "height": 200,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 16706.5625,
        "y": 7660,
        "width": 480,
        "height": 200,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 16726.5625,
        "y": 7160,
        "width": 370,
        "height": 140,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 16796.5625,
        "y": 7270,
        "width": 140,
        "height": 160,
        "properties": {}
    },
    {
        "type": "spawn",
        "x": 14956.5625,
        "y": 11670,
        "width": 1690,
        "height": 1970,
        "properties": {
            "spawnType": "rare"
        }
    },
    {
        "type": "spawn",
        "x": 16676.5625,
        "y": 1970,
        "width": 3100,
        "height": 3410,
        "properties": {
            "spawnType": "uncommon"
        }
    },
    {
        "type": "wall",
        "x": 9976.5625,
        "y": 14050,
        "width": 550,
        "height": 940,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 9336.5625,
        "y": 11950,
        "width": 1180,
        "height": 2130,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 4466.5625,
        "y": 10980,
        "width": 620,
        "height": 320,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 4796.5625,
        "y": 11810,
        "width": 840,
        "height": 290,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 4646.5625,
        "y": 11900,
        "width": 370,
        "height": 100,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 4766.5625,
        "y": 12380,
        "width": 1020,
        "height": 240,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 4656.5625,
        "y": 12870,
        "width": 2330,
        "height": 130,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 5986.5625,
        "y": 11580,
        "width": 240,
        "height": 1300,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 4766.5625,
        "y": 11390,
        "width": 1020,
        "height": 150,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 5656.5625,
        "y": 10750,
        "width": 970,
        "height": 680,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 6606.5625,
        "y": 12090,
        "width": 180,
        "height": 800,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 6726.5625,
        "y": 11670,
        "width": 340,
        "height": 470,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 6906.5625,
        "y": 10700,
        "width": 310,
        "height": 980,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 7156.5625,
        "y": 12110,
        "width": 100,
        "height": 1060,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 7256.5625,
        "y": 11850,
        "width": 430,
        "height": 310,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 7646.5625,
        "y": 12120,
        "width": 320,
        "height": 560,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 7226.5625,
        "y": 12530,
        "width": 280,
        "height": 190,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 7896.5625,
        "y": 12520,
        "width": 430,
        "height": 460,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 8206.5625,
        "y": 12950,
        "width": 340,
        "height": 590,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 7176.5625,
        "y": 11270,
        "width": 550,
        "height": 480,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 7656.5625,
        "y": 11600,
        "width": 520,
        "height": 170,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 7906.5625,
        "y": 11930,
        "width": 1320,
        "height": 340,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 8536.5625,
        "y": 12480,
        "width": 590,
        "height": 340,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 10006.5625,
        "y": 16720,
        "width": 1800,
        "height": 420,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 9846.5625,
        "y": 10200,
        "width": 2910,
        "height": 1130,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 7456.5625,
        "y": 9110,
        "width": 2720,
        "height": 1370,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 6786.5625,
        "y": 9260,
        "width": 530,
        "height": 1120,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 6186.5625,
        "y": 10250,
        "width": 680,
        "height": 250,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 6026.5625,
        "y": 10380,
        "width": 310,
        "height": 450,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 13146.5625,
        "y": 10020,
        "width": 470,
        "height": 1070,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 12356.5625,
        "y": 8320,
        "width": 560,
        "height": 1890,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 13136.5625,
        "y": 8890,
        "width": 300,
        "height": 410,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 12426.5625,
        "y": 7150,
        "width": 250,
        "height": 280,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 13306.5625,
        "y": 6830,
        "width": 290,
        "height": 420,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 11896.5625,
        "y": 7810,
        "width": 580,
        "height": 700,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 11496.5625,
        "y": 7000,
        "width": 580,
        "height": 1030,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 11916.5625,
        "y": 6220,
        "width": 270,
        "height": 940,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 14056.5625,
        "y": 3590,
        "width": 640,
        "height": 1250,
        "properties": {}
    },
    {
        "type": "spawn",
        "x": 7106.5625,
        "y": 11750,
        "width": 2140,
        "height": 1290,
        "properties": {
            "spawnType": "mythic"
        }
    },
    {
        "type": "spawn",
        "x": 4736.5625,
        "y": 11270,
        "width": 2160,
        "height": 1960,
        "properties": {
            "spawnType": "uncommon"
        }
    },
    {
        "type": "wall",
        "x": 3916.5625,
        "y": 9240,
        "width": 1970,
        "height": 1000,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 9756.5625,
        "y": 8050,
        "width": 1290,
        "height": 690,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 10836.5625,
        "y": 9220,
        "width": 970,
        "height": 590,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 4506.5625,
        "y": 7950,
        "width": 930,
        "height": 1520,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 5196.5625,
        "y": 7310,
        "width": 550,
        "height": 880,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 5496.5625,
        "y": 5210,
        "width": 370,
        "height": 2160,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 5796.5625,
        "y": 6560,
        "width": 2700,
        "height": 420,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 7416.5625,
        "y": 6960,
        "width": 430,
        "height": 1410,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 4956.5625,
        "y": 2200,
        "width": 660,
        "height": 3340,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 11736.5625,
        "y": 5920,
        "width": 300,
        "height": 350,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 11916.5625,
        "y": 4890,
        "width": 820,
        "height": 1050,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 12546.5625,
        "y": 4110,
        "width": 360,
        "height": 860,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 12926.5625,
        "y": 3060,
        "width": 350,
        "height": 1200,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 12826.5625,
        "y": 4000,
        "width": 230,
        "height": 280,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 13876.5625,
        "y": 3050,
        "width": 360,
        "height": 630,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 12486.5625,
        "y": 2570,
        "width": 590,
        "height": 580,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 13796.5625,
        "y": 2520,
        "width": 370,
        "height": 600,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 13306.5625,
        "y": 2060,
        "width": 630,
        "height": 730,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 12676.5625,
        "y": 1900,
        "width": 160,
        "height": 660,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 12636.5625,
        "y": 2440,
        "width": 170,
        "height": 240,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 12956.5625,
        "y": 980,
        "width": 410,
        "height": 1270,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 11836.5625,
        "y": 160,
        "width": 1350,
        "height": 930,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 7126.5625,
        "y": 1680,
        "width": 1100,
        "height": 540,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 7246.5625,
        "y": 3380,
        "width": 1390,
        "height": 610,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 9456.5625,
        "y": 2910,
        "width": 1460,
        "height": 780,
        "properties": {}
    },
    {
        "type": "spawn",
        "x": 7746.5625,
        "y": 4580,
        "width": 3340,
        "height": 1290,
        "properties": {
            "spawnType": "legendary"
        }
    },
    {
        "type": "spawn",
        "x": 5946.5625,
        "y": 2070,
        "width": 1030,
        "height": 3800,
        "properties": {
            "spawnType": "legendary"
        }
    },
    {
        "type": "spawn",
        "x": 4316.5625,
        "y": 540,
        "width": 3520,
        "height": 800,
        "properties": {
            "spawnType": "epic"
        }
    },
    {
        "type": "teleporter",
        "x": 2586.5625,
        "y": 2390,
        "width": 1200,
        "height": 4250,
        "properties": {
            "teleportTo": {
                "x": 0,
                "y": 0
            }
        }
    },
    {
        "type": "wall",
        "x": 406.5625,
        "y": 510,
        "width": 620,
        "height": 920,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 876.5625,
        "y": 830,
        "width": 1430,
        "height": 280,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 746.5625,
        "y": 3080,
        "width": 360,
        "height": 4260,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 1056.5625,
        "y": 4920,
        "width": 290,
        "height": 310,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 1106.5625,
        "y": 5850,
        "width": 350,
        "height": 420,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 936.5625,
        "y": 8120,
        "width": 2610,
        "height": 560,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 2016.5625,
        "y": 7300,
        "width": 660,
        "height": 280,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 1876.5625,
        "y": 4700,
        "width": 120,
        "height": 340,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 4206.5625,
        "y": 5690,
        "width": 400,
        "height": 1350,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 4516.5625,
        "y": 6250,
        "width": 620,
        "height": 260,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 1146.5625,
        "y": 10460,
        "width": 1260,
        "height": 280,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 566.5625,
        "y": 13460,
        "width": 380,
        "height": 220,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 796.5625,
        "y": 13330,
        "width": 420,
        "height": 160,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 2256.5625,
        "y": 13550,
        "width": 700,
        "height": 300,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 2696.5625,
        "y": 13350,
        "width": 210,
        "height": 320,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 7326.5625,
        "y": 16570,
        "width": 1700,
        "height": 350,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 9076.5625,
        "y": 6370,
        "width": 130,
        "height": 2350,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 3986.5625,
        "y": 6860,
        "width": 10,
        "height": 2080,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 6266.5625,
        "y": 7920,
        "width": 230,
        "height": 1930,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 9176.5625,
        "y": 6370,
        "width": 1020,
        "height": 310,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 10016.5625,
        "y": 6530,
        "width": 180,
        "height": 820,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 9786.5625,
        "y": 7180,
        "width": 380,
        "height": 190,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 9626.5625,
        "y": 7030,
        "width": 170,
        "height": 320,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 9186.5625,
        "y": 7680,
        "width": 990,
        "height": 120,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 6376.5625,
        "y": 7670,
        "width": 10,
        "height": 320,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 8226.5625,
        "y": 10340,
        "width": 1340,
        "height": 320,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 6.5625,
        "y": 6720,
        "width": 380,
        "height": 2280,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 2126.5625,
        "y": 12300,
        "width": 1290,
        "height": 600,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 3326.5625,
        "y": 11490,
        "width": 160,
        "height": 1380,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 3796.5625,
        "y": 6900,
        "width": 410,
        "height": 2080,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 1756.5625,
        "y": 6480,
        "width": 270,
        "height": 1130,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 10506.5625,
        "y": 12200,
        "width": 630,
        "height": 870,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 14116.5625,
        "y": 400,
        "width": 3390,
        "height": 930,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 15326.5625,
        "y": 6120,
        "width": 1590,
        "height": 260,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 15196.5625,
        "y": 10400,
        "width": 1710,
        "height": 190,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 66.5625,
        "y": 70,
        "width": 50,
        "height": 19910,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 116.5625,
        "y": 19980,
        "width": 0,
        "height": 0,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 76.5625,
        "y": 110,
        "width": 19890,
        "height": 60,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 19836.5625,
        "y": 150,
        "width": 60,
        "height": 19840,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 19836.5625,
        "y": 19990,
        "width": 0,
        "height": 0,
        "properties": {}
    },
    {
        "type": "wall",
        "x": 76.5625,
        "y": 19930,
        "width": 19790,
        "height": 50,
        "properties": {}
    },
    {
        "type": "spawn",
        "x": 9686.5625,
        "y": 6820,
        "width": 330,
        "height": 370,
        "properties": {
            "spawnType": "common"
        }
    },
    {
        "type": "spawn",
        "x": 10066.5625,
        "y": 8680,
        "width": 2410,
        "height": 1600,
        "properties": {
            "spawnType": "mythic"
        }
    },
    {
        "type": "teleporter",
        "x": 14976.5625,
        "y": 6980,
        "width": 490,
        "height": 560,
        "properties": {
            "teleportTo": {
                "x": 13067,
                "y": 6450
            }
        }
    },
    {
        "type": "teleporter",
        "x": 11286.5625,
        "y": 13580,
        "width": 1530,
        "height": 950,
        "properties": {
            "teleportTo": {
                "x": 13067,
                "y": 6450
            }
        }
    },
    {
        "type": "teleporter",
        "x": 1046.5625,
        "y": 10100,
        "width": 240,
        "height": 150,
        "properties": {
            "teleportTo": {
                "x": 13067,
                "y": 6450
            }
        }
    }
];
// Add map validation function
function validateWorldMap(map) {
    // Check for required border walls
    var hasTopWall = map.some(function (el) { return el.type === 'wall' && el.y === 0 && el.width === exports.WORLD_WIDTH; });
    var hasBottomWall = map.some(function (el) { return el.type === 'wall' && el.y === exports.WORLD_HEIGHT - 100; });
    var hasLeftWall = map.some(function (el) { return el.type === 'wall' && el.x === 0; });
    var hasRightWall = map.some(function (el) { return el.type === 'wall' && el.x === exports.WORLD_WIDTH - 100; });
    if (!hasTopWall || !hasBottomWall || !hasLeftWall || !hasRightWall) {
        console.error('Map is missing border walls');
        return false;
    }
    // Check for at least one spawn point per tier
    var spawnTypes = map
        .filter(function (el) { return el.type === 'spawn'; })
        .map(function (el) { var _a; return (_a = el.properties) === null || _a === void 0 ? void 0 : _a.spawnType; })
        .filter(function (type) { return type !== undefined; });
    var requiredSpawnTypes = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
    var hasAllSpawnTypes = requiredSpawnTypes.every(function (type) { return spawnTypes.includes(type); });
    if (!hasAllSpawnTypes) {
        console.error('Map is missing spawn points for some tiers');
        return false;
    }
    // Check for overlapping elements
    for (var i = 0; i < map.length; i++) {
        for (var j = i + 1; j < map.length; j++) {
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
