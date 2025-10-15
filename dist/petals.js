"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PETAL_CONFIG = exports.RARITY_LEVELS = void 0;
exports.getPetalStats = getPetalStats;
exports.getAllPetalTypes = getAllPetalTypes;
exports.getPetalRarities = getPetalRarities;
// Rarity levels in order from lowest to highest
exports.RARITY_LEVELS = [
    'common',
    'uncommon',
    'rare',
    'epic',
    'legendary',
    'mythic',
    'ultra',
    'super',
    'unique'
];
// Rarity-specific overrides for special cases
const RARITY_OVERRIDES = {
    stinger: {
        mythic: {
            image: `<svg width="200" height="200" xmlns="http://www.w3.org/2000/svg">
  <!-- Top triangle (Blue) -->
  <polygon
    points="100,20 150,110 50,110"
    style="fill:black;" />
  <!-- Bottom-left triangle (Red) -->
  <polygon
    points="50,110 100,200 0,200"
    style="fill:black;" />
  <!-- Bottom-right triangle (Green) -->
  <polygon
    points="150,110 200,200 100,200"
    style="fill:black;" />
</svg>`
        },
        ultra: {
            image: `<svg width="200" height="200" xmlns="http://www.w3.org/2000/svg">
  <!-- Top triangle (Blue) -->
  <polygon
    points="100,20 150,110 50,110"
    style="fill:black;" />
  <!-- Bottom-left triangle (Red) -->
  <polygon
    points="50,110 100,200 0,200"
    style="fill:black;" />
  <!-- Bottom-right triangle (Green) -->
  <polygon
    points="150,110 200,200 100,200"
    style="fill:black;" />
</svg>`
        },
        super: {
            image: `<svg width="200" height="200" xmlns="http://www.w3.org/2000/svg">
  <!-- Top triangle (Blue) -->
  <polygon
    points="100,20 150,110 50,110"
    style="fill:black;" />
  <!-- Bottom-left triangle (Red) -->
  <polygon
    points="50,110 100,200 0,200"
    style="fill:black;" />
  <!-- Bottom-right triangle (Green) -->
  <polygon
    points="150,110 200,200 100,200"
    style="fill:black;" />
</svg>`
        },
        unique: {
            image: `<svg width="200" height="200" xmlns="http://www.w3.org/2000/svg">
  <!-- Top triangle (Blue) -->
  <polygon
    points="100,20 150,110 50,110"
    style="fill:black;" />
  <!-- Bottom-left triangle (Red) -->
  <polygon
    points="50,110 100,200 0,200"
    style="fill:black;" />
  <!-- Bottom-right triangle (Green) -->
  <polygon
    points="150,110 200,200 100,200"
    style="fill:black;" />
</svg>`
        }
    },
    light: {
        uncommon: {
            count: 2
        },
        rare: {
            count: 2
        },
        epic: {
            count: 3
        },
        legendary: {
            count: 3
        },
        mythic: {
            count: 5
        },
        ultra: {
            count: 5
        },
        super: {
            count: 5
        },
        unique: {
            count: 5
        }
    }
};
// Base petal configurations - only common rarity stats
const BASE_PETAL_CONFIGS = {
    basic: {
        name: "Basic Petal",
        damage: 10,
        health: 10,
        size: 2.0,
        cooldown: 1200,
        description: "A simple petal that provides basic protection",
        color: "#90EE90",
        count: 1,
        image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="14" fill="white" stroke-width="4" stroke="#d9d9d9"/>
</svg>`
    },
    rose: {
        name: "Rose Petal",
        damage: 5,
        health: 5,
        size: 0.9,
        cooldown: 1500,
        description: "A thorny petal that deals extra damage",
        color: "#FF69B4",
        count: 1,
        image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="14" fill="#ff94f4" stroke="#d17bc9" stroke-width="4"/>
</svg>`
    },
    stinger: {
        name: "Stinger",
        damage: 100,
        health: 2,
        size: 1.0,
        cooldown: 5000,
        description: "A fast, sharp petal that prioritizes offense",
        color: "#FFD700",
        count: 1,
        image: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <polygon points="16,0 32,32 0,32" fill="black" />
</svg>`
    },
    light: {
        name: "Light Petal",
        damage: 5,
        health: 5,
        size: 1.0,
        cooldown: 400,
        description: "A light petal that provides basic protection",
        color: "#90EE90",
        count: 1,
        image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="14" fill="white" stroke-width="4" stroke="#faffc9"/>
</svg>`
    },
    rock: {
        name: "Rock Petal",
        damage: 15,
        health: 45,
        size: 1.0,
        cooldown: 400,
        description: "A rock petal that provides basic protection",
        color: "#8B0000",
        count: 1,
        image: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <polygon
    points="16,1.4 30.6,12.3 25,29.6 7,29.6 1.4,12.3"
    fill="#777777"
    stroke="#606060"
    stroke-width="2"
    stroke-linecap="round"
  />
</svg>`
    },
    sand: {
        name: "Sand Petal",
        damage: 10,
        health: 10,
        size: 1.0,
        cooldown: 400,
        description: "A sand petal that provides basic protection",
        color: "#8B0000",
        count: 1,
        image: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <polygon
    points="16,1.4 30.6,12.3 25,29.6 7,29.6 1.4,12.3"
    fill="#777777"
    stroke="#606060"
    stroke-width="2"
    stroke-linecap="round"
  />
</svg>`
    }
};
// Rarity color mappings
const RARITY_COLORS = {
    common: "#90EE90",
    uncommon: "#32CD32",
    rare: "#228B22",
    epic: "#006400",
    legendary: "#8B4513",
    mythic: "#4B0082",
    ultra: "#de1f65",
    super: "#2bffa4",
    unique: "#bf00ff"
};
// Rarity name prefixes
const RARITY_PREFIXES = {
    common: "",
    uncommon: "Enhanced",
    rare: "Superior",
    epic: "Elite",
    legendary: "Legendary",
    mythic: "Mythic",
    ultra: "Ultra",
    super: "Super",
    unique: "Unique"
};
// Function to find SVG fallback for higher rarities
function findSvgFallback(petalType, rarity) {
    const rarityIndex = exports.RARITY_LEVELS.indexOf(rarity);
    // Try to find SVG from lower rarities
    for (let i = rarityIndex - 1; i >= 0; i--) {
        const lowerRarity = exports.RARITY_LEVELS[i];
        const petalConfig = exports.PETAL_CONFIG[petalType]?.[lowerRarity];
        if (petalConfig?.image) {
            return petalConfig.image;
        }
    }
    // Fallback to base config SVG
    return BASE_PETAL_CONFIGS[petalType]?.image;
}
// Function to generate petal stats for a specific rarity
function generatePetalStats(baseConfig, rarity, petalType) {
    const rarityIndex = exports.RARITY_LEVELS.indexOf(rarity);
    const multiplier = Math.pow(3, rarityIndex); // 3x multiplier for each rarity level
    const prefix = RARITY_PREFIXES[rarity];
    const name = prefix ? `${prefix} ${baseConfig.name}` : baseConfig.name;
    // Get rarity-specific overrides
    const overrides = RARITY_OVERRIDES[petalType]?.[rarity] || {};
    return {
        name,
        damage: baseConfig.damage * multiplier,
        health: baseConfig.health * multiplier,
        size: baseConfig.size, // Size stays the same for each petal type
        speed: baseConfig.speed ?? 1.0, // Default speed
        cooldown: baseConfig.cooldown,
        knockback: baseConfig.knockback ?? 1, // Default knockback
        description: overrides.description ?? baseConfig.description,
        color: RARITY_COLORS[rarity],
        image: overrides.image ?? baseConfig.image ?? findSvgFallback(petalType, rarity),
        count: overrides.count ?? baseConfig.count
    };
}
// Generate the full petal configuration
exports.PETAL_CONFIG = {};
// Initialize the petal configuration
for (const petalType in BASE_PETAL_CONFIGS) {
    exports.PETAL_CONFIG[petalType] = {};
    for (const rarity of exports.RARITY_LEVELS) {
        exports.PETAL_CONFIG[petalType][rarity] = generatePetalStats(BASE_PETAL_CONFIGS[petalType], rarity, petalType);
    }
}
function getPetalStats(petalType, rarity) {
    return exports.PETAL_CONFIG[petalType]?.[rarity] || null;
}
function getAllPetalTypes() {
    return Object.keys(exports.PETAL_CONFIG);
}
function getPetalRarities(petalType) {
    return Object.keys(exports.PETAL_CONFIG[petalType] || {});
}
