"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ITEM_EXPIRATION_TIMES = exports.petalCooldownTimeouts = exports.itemExpirationTimeouts = exports.petalLastProjectileTime = exports.playerProjectiles = exports.mobProjectiles = exports.playerUserIds = exports.ENEMY_COUNT = exports.sands = exports.decorations = exports.superMobPerSection = exports.uniqueMobCount = exports.superMobCount = exports.ultraMobCount = exports.items = void 0;
exports.getUltraMobCount = getUltraMobCount;
exports.setUltraMobCount = setUltraMobCount;
exports.getSuperMobCount = getSuperMobCount;
exports.setSuperMobCount = setSuperMobCount;
exports.getUniqueMobCount = getUniqueMobCount;
exports.setUniqueMobCount = setUniqueMobCount;
exports.getSuperMobPerSection = getSuperMobPerSection;
exports.setSuperMobInSection = setSuperMobInSection;
exports.getSuperMobInSection = getSuperMobInSection;
exports.clearSuperMobFromSection = clearSuperMobFromSection;
exports.initializeMapObstacles = initializeMapObstacles;
exports.getPlayers = getPlayers;
exports.getEnemies = getEnemies;
exports.getItems = getItems;
exports.getMobProjectiles = getMobProjectiles;
exports.getPlayerProjectiles = getPlayerProjectiles;
exports.setEnemyCount = setEnemyCount;
exports.getEnemyCount = getEnemyCount;
const constants_1 = require("../constants");
// Game state variables
exports.items = [];
// Special mob tracking - using getters/setters for mutability
let _ultraMobCount = 0;
let _superMobCount = 0;
let _uniqueMobCount = 0;
let _ENEMY_COUNT = 1000;
// Track super bosses per section (9 sections, 0-8)
// Section layout:
//   0 | 1 | 2
//   ---------
//   3 | 4 | 5
//   ---------
//   6 | 7 | 8
let _superMobPerSection = [null, null, null, null, null, null, null, null, null];
function getUltraMobCount() { return _ultraMobCount; }
function setUltraMobCount(value) { _ultraMobCount = value; }
function getSuperMobCount() { return _superMobCount; }
function setSuperMobCount(value) { _superMobCount = value; }
function getUniqueMobCount() { return _uniqueMobCount; }
function setUniqueMobCount(value) { _uniqueMobCount = value; }
// Super boss per section tracking
function getSuperMobPerSection() { return _superMobPerSection; }
function setSuperMobInSection(section, mobId) {
    if (section >= 0 && section < 9) {
        _superMobPerSection[section] = mobId;
    }
}
function getSuperMobInSection(section) {
    return (section >= 0 && section < 9) ? _superMobPerSection[section] : null;
}
function clearSuperMobFromSection(section) {
    if (section >= 0 && section < 9) {
        _superMobPerSection[section] = null;
    }
}
// For backwards compatibility, export as mutable objects
exports.ultraMobCount = { get value() { return _ultraMobCount; }, set value(v) { _ultraMobCount = v; } };
exports.superMobCount = { get value() { return _superMobCount; }, set value(v) { _superMobCount = v; } };
exports.uniqueMobCount = { get value() { return _uniqueMobCount; }, set value(v) { _uniqueMobCount = v; } };
exports.superMobPerSection = {
    get value() { return _superMobPerSection; },
    set value(v) { _superMobPerSection = v; }
};
exports.decorations = [];
exports.sands = [];
exports.ENEMY_COUNT = { get value() { return _ENEMY_COUNT; }, set value(v) { _ENEMY_COUNT = v; } };
exports.playerUserIds = {}; // Maps player ID to user ID
exports.mobProjectiles = []; // Track all active mob projectiles
exports.playerProjectiles = []; // Track all active player projectiles
exports.petalLastProjectileTime = new Map(); // Track last projectile time per petal instance
// Track item expiration timeouts for cleanup
exports.itemExpirationTimeouts = new Map();
// Track petal cooldown timeouts for cleanup (key: `${socketId}-${loadoutIndex}`)
exports.petalCooldownTimeouts = new Map();
// Item expiration times based on rarity (in milliseconds)
exports.ITEM_EXPIRATION_TIMES = {
    common: 10000, // 10 seconds
    uncommon: 20000, // 20 seconds
    rare: 30000, // 30 seconds
    epic: 40000, // 40 seconds
    legendary: 50000, // 50 seconds
    mythic: 60000, // 60 seconds
    ultra: 80000, // 80 seconds
    super: 120000, // 120 seconds
    unique: 300000 // 300 seconds (5 minutes)
};
// Initialize map obstacles
function initializeMapObstacles() {
    const mapObstacles = [];
    // Convert wall elements from WORLD_MAP to obstacles
    constants_1.WORLD_MAP.filter(constants_1.isWall).forEach(wall => {
        mapObstacles.push({
            id: Math.random().toString(36).substr(2, 9),
            x: wall.x * constants_1.SCALE_FACTOR,
            y: wall.y * constants_1.SCALE_FACTOR,
            width: wall.width * constants_1.SCALE_FACTOR,
            height: wall.height * constants_1.SCALE_FACTOR,
            type: 'coral',
            isEnemy: false
        });
    });
    return mapObstacles;
}
// Export getters for game state
function getPlayers() {
    return constants_1.players;
}
function getEnemies() {
    return constants_1.enemies;
}
function getItems() {
    return exports.items;
}
function getMobProjectiles() {
    return exports.mobProjectiles;
}
function getPlayerProjectiles() {
    return exports.playerProjectiles;
}
function setEnemyCount(count) {
    _ENEMY_COUNT = count;
}
function getEnemyCount() {
    return _ENEMY_COUNT;
}
