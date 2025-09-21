"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.workerBlob = void 0;
exports.workerBlob = new Blob([`
// Worker code starts here
const WORLD_WIDTH = 20000;
const WORLD_HEIGHT = 20000;
const SCALE_FACTOR = 1;
const ACTUAL_WORLD_WIDTH = 20000;
const ACTUAL_WORLD_HEIGHT = 20000;
const FISH_DETECTION_RADIUS = 500;
const PLAYER_BASE_SPEED = 5;
const FISH_RETURN_SPEED = 0.5;
const ENEMY_COUNT = 3000;
const OBSTACLE_COUNT = 20;
const ENEMY_CORAL_PROBABILITY = 0.3;
const ENEMY_CORAL_HEALTH = 50;
const PLAYER_MAX_HEALTH = 100;
const PLAYER_DAMAGE = 10;
const ITEM_COUNT = 10;
const MAX_INVENTORY_SIZE = 5;
const PLAYER_SIZE = 40;
const COLLISION_RADIUS = PLAYER_SIZE / 2;
const ENEMY_SIZE = 40;
const RESPAWN_INVULNERABILITY_TIME = 3000;
const KNOCKBACK_FORCE = 20;
const KNOCKBACK_RECOVERY_SPEED = 0.9;

// Add movement constants
const PLAYER_SPEED = 5;
const PLAYER_DIAGONAL_SPEED = PLAYER_SPEED / Math.sqrt(2);

// Add physics constants
const ACCELERATION = 0.5;
const MAX_SPEED = 12;
const FRICTION = 0.1;
const DELTA_TIME = 1000 / 240; // 240 FPS

// Add enemy movement constants
const ENEMY_DIRECTION_CHANGE_INTERVAL = 2000; // ms between direction changes
const ENEMY_MOVEMENT_SPEED = 0.5; // Reduced from 2

// Mock Socket class implementation
class MockSocket {
    constructor() {
        this.eventHandlers = new Map();
        this.id = 'player1';
    }
    on(event, handler) {
        if (!this.eventHandlers.has(event)) {
            this.eventHandlers.set(event, []);
        }
        this.eventHandlers.get(event).push(handler);
    }
    emit(event, data) {
        self.postMessage({
            type: 'socketEvent',
            event,
            data
        });
    }
    getId() {
        return this.id;
    }
}

const socket = new MockSocket();
const socketHandlers = new Map();

// Game state
const players = {};
const enemies = [];
const items = [];
const dots = [];
const decorations = [];

// Add the map data structure
const WORLD_MAP = [
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

const ENEMY_TIERS = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'];
const ENEMY_SIZES = [10, 20, 30, 40, 50, 60];
const ENEMY_HEALTHS = [10, 20, 30, 40, 50, 60];
const ENEMY_SPEEDS = [1, 2, 3, 4, 5, 6];
const ENEMY_DAMAGES = [1, 2, 3, 4, 5, 6];
const ENEMY_XP = [10, 20, 30, 40, 50, 60];

// Helper functions
function isWall(element) {
    return element.type === 'wall';
}

function calculateXPRequirement(level) {
    return Math.floor(100 * Math.pow(1.5, level - 1));
}

function createEnemy() {
    return {
        id: Math.random().toString(36).substr(2, 9),
        type: Math.random() < 0.5 ? 'octopus' : 'fish',
        tier: ENEMY_TIERS[Math.floor(Math.random() * ENEMY_TIERS.length)],
        x: Math.random() * ACTUAL_WORLD_WIDTH,
        y: Math.random() * ACTUAL_WORLD_HEIGHT,
        angle: Math.random() * Math.PI * 2,
        health: ENEMY_HEALTHS[Math.floor(Math.random() * ENEMY_HEALTHS.length)],
        speed: ENEMY_SPEEDS[Math.floor(Math.random() * ENEMY_SPEEDS.length)],
        damage: ENEMY_DAMAGES[Math.floor(Math.random() * ENEMY_DAMAGES.length)],
        xp: ENEMY_XP[Math.floor(Math.random() * ENEMY_XP.length)],
        knockbackX: 50,
        knockbackY: 50,
        size: ENEMY_SIZES[Math.floor(Math.random() * ENEMY_SIZES.length)]
    };
}

function createItem() {
    return {
        id: Math.random().toString(36).substr(2, 9),
        type: ['health_potion', 'speed_boost', 'shield'][Math.floor(Math.random() * 3)],
        x: Math.random() * ACTUAL_WORLD_WIDTH,
        y: Math.random() * ACTUAL_WORLD_HEIGHT,
        rarity: 'common'
    };
}

function createDecoration() {
    return {
        x: Math.random() * ACTUAL_WORLD_WIDTH,
        y: Math.random() * ACTUAL_WORLD_HEIGHT,
        scale: 0.5 + Math.random() * 1.5
    };
}

// Add this to store enemy movement states
const enemyStates = new Map();

function moveEnemies() {
    const currentTime = Date.now();
    
    enemies.forEach(enemy => {
        // Initialize or update enemy state
        if (!enemyStates.has(enemy.id)) {
            enemyStates.set(enemy.id, {
                angle: Math.random() * Math.PI * 2,
                lastDirectionChange: currentTime
            });
        }
        
        let state = enemyStates.get(enemy.id);
        
        // Change direction periodically
        if (currentTime - state.lastDirectionChange > ENEMY_DIRECTION_CHANGE_INTERVAL) {
            state.angle = Math.random() * Math.PI * 2;
            state.lastDirectionChange = currentTime;
        }

        // Handle knockback
        if (enemy.knockbackX || enemy.knockbackY) {
            enemy.x += enemy.knockbackX;
            enemy.y += enemy.knockbackY;
            
            enemy.knockbackX *= KNOCKBACK_RECOVERY_SPEED;
            enemy.knockbackY *= KNOCKBACK_RECOVERY_SPEED;

            if (Math.abs(enemy.knockbackX) < 0.1) enemy.knockbackX = 0;
            if (Math.abs(enemy.knockbackY) < 0.1) enemy.knockbackY = 0;
        }

        // Move enemy in current direction
        enemy.x += Math.cos(state.angle) * ENEMY_MOVEMENT_SPEED;
        enemy.y += Math.sin(state.angle) * ENEMY_MOVEMENT_SPEED;
        enemy.angle = state.angle; // Update enemy's visual angle

        // Keep within bounds
        enemy.x = Math.max(ENEMY_SIZE/2, Math.min(ACTUAL_WORLD_WIDTH - ENEMY_SIZE/2, enemy.x));
        enemy.y = Math.max(ENEMY_SIZE/2, Math.min(ACTUAL_WORLD_HEIGHT - ENEMY_SIZE/2, enemy.y));
    });
}

function initializeGame(messageData) {
    console.log('Initializing game state in worker');
    
    // Send map data first
    socket.emit('mapData', WORLD_MAP);
    
    // Initialize player
    const savedProgress = messageData.savedProgress || {};
    const level = parseInt(savedProgress.level) || 1;
    const xp = parseInt(savedProgress.xp) || 0;
    
    players[socket.id] = {
        id: socket.id,
        x: 300,
        y: 10000,
        angle: 0,
        score: 0,
        velocityX: 0,
        velocityY: 0,
        health: PLAYER_MAX_HEALTH,
        maxHealth: PLAYER_MAX_HEALTH,
        damage: PLAYER_DAMAGE,
        inventory: [],
        loadout: Array(10).fill(null),
        isInvulnerable: true,
        level: level,
        xp: xp,
        xpToNextLevel: calculateXPRequirement(level)
    };

    // Initialize game objects
    for (let i = 0; i < ENEMY_COUNT; i++) {
        enemies.push(createEnemy());
    }

    for (let i = 0; i < ITEM_COUNT; i++) {
        items.push(createItem());
    }

    for (let i = 0; i < 100; i++) {
        decorations.push(createDecoration());
    }

    // Send initial state to client
    socket.emit('currentPlayers', players);
    socket.emit('enemiesUpdate', enemies);
    socket.emit('itemsUpdate', items);
    socket.emit('decorationsUpdate', decorations);

    // Start game loop
    startGameLoop();
}

function updateGame() {
    // Update player states
    Object.values(players).forEach(player => {
        // Add gradual health recovery with a reasonable rate
        if (player.health < player.maxHealth) {
            // Recover 5 health per second (assuming 240 FPS)
            player.health = Math.min(player.maxHealth, player.health + (5/500));
            
            // Emit health update to keep client in sync
            socket.emit('playerDamaged', {
                playerId: player.id,
                health: player.health,
                maxHealth: player.maxHealth,
                knockbackX: 0,
                knockbackY: 0
            });
        }
    });

    // Add collision detection
    handleCollisions();

    // Update enemy states
    enemies.forEach(enemy => {
        if (enemy.knockbackX) {
            enemy.knockbackX *= KNOCKBACK_RECOVERY_SPEED;
            if (Math.abs(enemy.knockbackX) < 0.1) enemy.knockbackX = 0;
        }
        if (enemy.knockbackY) {
            enemy.knockbackY *= KNOCKBACK_RECOVERY_SPEED;
            if (Math.abs(enemy.knockbackY) < 0.1) enemy.knockbackY = 0;
        }
    });
}

function sendGameState() {
    socket.emit('currentPlayers', players);
    socket.emit('enemiesUpdate', enemies);
    socket.emit('itemsUpdate', items);
}

// Update the player movement handler
socketHandlers.set('playerMovement', (movementData) => {
    console.log('playerMovement', movementData);
    const currentPlayer = players[socket.id];
    if (currentPlayer) {
        // Apply acceleration based on input
        if (movementData.velocityX !== 0) {
            currentPlayer.velocityX += movementData.velocityX * ACCELERATION;
            currentPlayer.velocityX = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, currentPlayer.velocityX));
        } else {
            currentPlayer.velocityX *= FRICTION;
        }

        if (movementData.velocityY !== 0) {
            currentPlayer.velocityY += movementData.velocityY * ACCELERATION;
            currentPlayer.velocityY = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, currentPlayer.velocityY));
        } else {
            currentPlayer.velocityY *= FRICTION;
        }

        // Calculate new position based on velocity
        let newX = currentPlayer.x + currentPlayer.velocityX;
        let newY = currentPlayer.y + currentPlayer.velocityY;

        // Apply knockback
        if (currentPlayer.knockbackX) {
            currentPlayer.knockbackX *= KNOCKBACK_RECOVERY_SPEED;
            newX += currentPlayer.knockbackX;
            if (Math.abs(currentPlayer.knockbackX) < 0.1) currentPlayer.knockbackX = 0;
        }
        if (currentPlayer.knockbackY) {
            currentPlayer.knockbackY *= KNOCKBACK_RECOVERY_SPEED;
            newY += currentPlayer.knockbackY;
            if (Math.abs(currentPlayer.knockbackY) < 0.1) currentPlayer.knockbackY = 0;
        }

        // Ensure player stays within world bounds

        // Check for wall collisions
        let collision = false;
        for (const element of WORLD_MAP) {
            if (element.type === 'wall') {
                const wallX = element.x * SCALE_FACTOR;
                const wallY = element.y * SCALE_FACTOR;
                const wallWidth = element.width * SCALE_FACTOR;
                const wallHeight = element.height * SCALE_FACTOR;

                // Add padding to wall collision box
                const PADDING = PLAYER_SIZE / 2;
                const WALL_PADDING = 5;

                if (
                    newX - PADDING < wallX + wallWidth + WALL_PADDING &&
                    newX + PADDING > wallX - WALL_PADDING &&
                    newY - PADDING < wallY + wallHeight + WALL_PADDING &&
                    newY + PADDING > wallY - WALL_PADDING
                ) {
                    collision = true;
                    // Calculate the closest point on the wall to the player
                    const closestX = Math.max(wallX, Math.min(wallX + wallWidth, newX));
                    const closestY = Math.max(wallY, Math.min(wallY + wallHeight, newY));

                    // Calculate vector from closest point to player
                    const dx = newX - closestX;
                    const dy = newY - closestY;
                    const distance = Math.sqrt(dx * dx + dy * dy);

                    if (distance < PADDING) {
                        // Push player away from wall
                        if (distance > 0) {
                            newX = closestX + (dx / distance) * (PADDING + 1);
                            newY = closestY + (dy / distance) * (PADDING + 1);
                            
                            // Bounce velocity off wall
                            if (Math.abs(dx) > Math.abs(dy)) {
                                currentPlayer.velocityX *= -0.5; // Bounce with dampening
                            } else {
                                currentPlayer.velocityY *= -0.5; // Bounce with dampening
                            }
                        }
                    }
                }
            }
        }

        // Update player position and movement
        currentPlayer.x = newX;
        currentPlayer.y = newY;
        currentPlayer.angle = movementData.angle;

        // Always emit the updated position
        socket.emit('playerMoved', currentPlayer);
    }
});

// Update the game loop to use fixed timestep
let lastUpdateTime = Date.now();

function startGameLoop() {
    setInterval(() => {
        try {
            const currentTime = Date.now();
            const deltaTime = currentTime - lastUpdateTime;
            lastUpdateTime = currentTime;

            // Update physics with delta time
            updatePhysics(deltaTime);
            moveEnemies();
            updateGame();
            sendGameState();
        } catch (error) {
            console.error('Error in game loop:', error);
        }
    }, DELTA_TIME);
}

function updatePhysics(deltaTime) {
    const timeStep = deltaTime / DELTA_TIME;
    
    Object.values(players).forEach(player => {
        // Apply friction
        // player.velocityX *= Math.pow(FRICTION, timeStep);
        // player.velocityY *= Math.pow(FRICTION, timeStep);

        // Apply knockback decay
        if (player.knockbackX) {
            player.knockbackX *= Math.pow(KNOCKBACK_RECOVERY_SPEED, timeStep);
            if (Math.abs(player.knockbackX) < 0.1) player.knockbackX = 0;
        }
        if (player.knockbackY) {
            player.knockbackY *= Math.pow(KNOCKBACK_RECOVERY_SPEED, timeStep);
            if (Math.abs(player.knockbackY) < 0.1) player.knockbackY = 0;
        }
    });
}

// Add collision detection functions after the helper functions
function checkCollision(x1, y1, r1, x2, y2, r2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const distance = Math.sqrt(dx * dx + dy * dy);
    return distance < (r1 + r2);
}

function handleCollisions() {
    const player = players[socket.id];
    if (!player) return;

    // Player-Enemy collisions
    enemies.forEach((enemy, index) => {
        const dx = player.x - enemy.x;
        const dy = player.y - enemy.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const minDistance = COLLISION_RADIUS + (ENEMY_SIZE / 2);

        if (distance < minDistance) {
            console.log('Collision detected!', {
                distance,
                minDistance,
                playerHealth: player.health,
                enemyDamage: enemy.damage
            });

            // Calculate normalized knockback direction
            const knockbackDirX = dx / distance;
            const knockbackDirY = dy / distance;
            
            // Apply knockback to player
            player.knockbackX = knockbackDirX * KNOCKBACK_FORCE;
            player.knockbackY = knockbackDirY * KNOCKBACK_FORCE;
            
            // Apply opposite knockback to enemy
            enemy.knockbackX = -knockbackDirX * (KNOCKBACK_FORCE / 2);
            enemy.knockbackY = -knockbackDirY * (KNOCKBACK_FORCE / 2);
            
            // Damage player
            player.health = Math.max(0, player.health - enemy.damage);
            console.log('Player damaged:', {
                newHealth: player.health,
                damage: enemy.damage
            });

            // Emit damage event
            socket.emit('playerDamaged', {
                playerId: player.id,
                health: player.health,
                maxHealth: player.maxHealth,
                knockbackX: player.knockbackX,
                knockbackY: player.knockbackY
            });

            // Check if player died
            if (player.health <= 0) {
                console.log('Player died!');
                socket.emit('playerDied', player.id);
                player.health = player.maxHealth;
                player.x = 300; // Respawn position
                player.y = 10000;
            }

            // Damage enemy
            enemy.health -= player.damage;
            
            // Check if enemy died
            if (enemy.health <= 0) {
                enemies.splice(index, 1);
                
                // Calculate XP based on enemy tier
                const xpGained = ENEMY_XP[ENEMY_TIERS.indexOf(enemy.tier)];
                player.xp += xpGained;
                
                // Check for level up
                if (player.xp >= player.xpToNextLevel) {
                    player.level++;
                    player.xp -= player.xpToNextLevel;
                    player.xpToNextLevel = calculateXPRequirement(player.level);
                    player.maxHealth += PLAYER_DAMAGE;
                    player.damage += 2;
                    
                    socket.emit('levelUp', {
                        playerId: player.id,
                        level: player.level,
                        maxHealth: player.maxHealth,
                        damage: player.damage
                    });
                }
                
                socket.emit('xpGained', {
                    playerId: player.id,
                    xp: xpGained,
                    totalXp: player.xp,
                    level: player.level,
                    xpToNextLevel: player.xpToNextLevel,
                    maxHealth: player.maxHealth,
                    damage: player.damage
                });
            }
        }
    });

    // Player-Item collisions
    items.forEach((item, index) => {
        if (checkCollision(
            player.x, 
            player.y, 
            COLLISION_RADIUS, 
            item.x, 
            item.y, 
            20 // Item radius
        )) {
            if (player.inventory.length < MAX_INVENTORY_SIZE) {
                player.inventory.push(item);
                items.splice(index, 1);
                socket.emit('itemCollected', {
                    playerId: player.id,
                    item: item,
                    inventory: player.inventory
                });
            }
        }
    });
}

// Message handler
self.onmessage = function(event) {
    const { type, event: socketEvent, data } = event.data;
    
    switch (type) {
        case 'init':
            initializeGame(event.data);
            break;
        case 'socketEvent':
            const handler = socketHandlers.get(socketEvent);
            if (handler) {
                handler(data);
            }
            break;
    }
};
`], { type: 'application/javascript' });
