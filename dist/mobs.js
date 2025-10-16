"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MOB_DROP_TABLES = exports.MOB_CONFIG = exports.RARITY_LEVELS = void 0;
exports.getMobStats = getMobStats;
exports.getAllMobTypes = getAllMobTypes;
exports.getMobRarities = getMobRarities;
exports.calculateMobDrops = calculateMobDrops;
exports.getMobDropTable = getMobDropTable;
exports.testDropSystem = testDropSystem;
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
// Scaling multipliers for mob stats
const HEALTH_SCALING = {
    common: 1,
    uncommon: 3.75,
    rare: 13.5,
    epic: 54,
    legendary: 405,
    mythic: 2430,
    ultra: 29160,
    super: 1312200,
    unique: 19683000
};
const DAMAGE_SCALING = {
    common: 1,
    uncommon: 3.75,
    rare: 13.5,
    epic: 54,
    legendary: 405,
    mythic: 2430,
    ultra: 29160,
    super: 1312200,
    unique: 19683000
};
const SIZE_SCALING = {
    common: 1,
    uncommon: 1.2,
    rare: 1.6,
    epic: 2.56,
    legendary: 4.096,
    mythic: 6.5536,
    ultra: 10.48576,
    super: 16.777216,
    unique: 26.8435456
};
// Separate XP tables for each mob type (maintaining original values)
const MOB_XP_TABLES = {
    bee: {
        common: 1,
        uncommon: 3,
        rare: 30,
        epic: 270,
        legendary: 1400,
        mythic: 32000,
        ultra: 150000,
        super: 1200000,
        unique: 6800000
    },
    ladybug: {
        common: 1,
        uncommon: 3,
        rare: 30,
        epic: 270,
        legendary: 1400,
        mythic: 32000,
        ultra: 150000,
        super: 1200000,
        unique: 6800000
    },
    soldier_ant: {
        common: 1,
        uncommon: 3,
        rare: 30,
        epic: 270,
        legendary: 1400,
        mythic: 32000,
        ultra: 150000,
        super: 1200000,
        unique: 6800000
    },
    rock: {
        common: 1,
        uncommon: 1,
        rare: 2,
        epic: 22,
        legendary: 206,
        mythic: 3100,
        ultra: 19800,
        super: 2100000,
        unique: 6800000
    }
};
// Base mob configurations - only common rarity stats
const BASE_MOB_CONFIGS = {
    bee: {
        name: "Common Bee",
        damage: 50,
        health: 37.5,
        size: 1.0,
        speed: 0.5,
        cooldown: 2000,
        description: "A small, harmless bee that flies peacefully",
        color: "#87CEEB",
        image: `<svg width="32" height="32" viewBox="-45 -30 95 60" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="bee-body-clip">
      <ellipse cx="0" cy="0" rx="30" ry="20" />
    </clipPath>
  </defs>

  <path 
    d="M -25 9 L -37 0 L -25 -9" 
    fill="#333333" 
    stroke="#292929" 
    stroke-width="5" 
    stroke-linecap="round" 
    stroke-linejoin="round" 
  />

  <ellipse 
    cx="0" 
    cy="0" 
    rx="30" 
    ry="20" 
    fill="#ffe763" 
  />

  <g clip-path="url(#bee-body-clip)">
    <rect x="-30" y="-20" width="10" height="40" fill="#333333" />
    <rect x="-10" y="-20" width="10" height="40" fill="#333333" />
    <rect x="10" y="-20" width="10" height="40" fill="#333333" />
  </g>

  <ellipse 
    cx="0" 
    cy="0" 
    rx="30" 
    ry="20" 
    fill="none" 
    stroke="#ccb94f" 
    stroke-width="5" 
  />

  <g stroke="#333333" fill="#333333">
    <path d="M 25 -5 Q 35 -5 40 -15" stroke-width="3" fill="none" />
    <circle cx="40" cy="-15" r="5" />
  </g>

  <g stroke="#333333" fill="#333333">
    <path d="M 25 5 Q 35 5 40 15" stroke-width="3" fill="none" />
    <circle cx="40" cy="15" r="5" />
  </g>
</svg>`,
        is_hostile: false,
        range: 100
    },
    ladybug: {
        name: "Common Ladybug",
        damage: 10,
        health: 62.5,
        size: 0.667,
        speed: 0.5,
        cooldown: 2000,
        description: "A small, harmless ladybug that flies peacefully",
        color: "#87CEEB",
        image: `<svg width="32" height="32" viewBox="-38 -38 76 76" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="ladybug-body-clip">
      <path d="M 24.76 16.93 Q 17.74 27.19 5.53 29.48 Q -6.68 31.77 -16.93 24.76 Q -27.19 17.74 -29.48 5.53 Q -31.77 -6.68 -24.76 -16.93 Q -17.74 -27.19 -5.53 -29.48 Q 6.68 -31.77 16.93 -24.76 Q 19.24 -23.18 21.21 -21.21 Q 23.18 -19.24 24.76 -16.93 Q 10 0 24.76 16.93 Z" />
    </clipPath>
  </defs>

  <circle cx="15" cy="0" r="18.5" fill="#111111" />

  <path 
    fill="#eb4034" 
    fill-rule="evenodd"
    d="M 24.76 16.93 Q 17.74 27.19 5.53 29.48 Q -6.68 31.77 -16.93 24.76 Q -27.19 17.74 -29.48 5.53 Q -31.77 -6.68 -24.76 -16.93 Q -17.74 -27.19 -5.53 -29.48 Q 6.68 -31.77 16.93 -24.76 Q 19.24 -23.18 21.21 -21.21 Q 23.18 -19.24 24.76 -16.93 Q 10 0 24.76 16.93 Z"
  />

  <g clip-path="url(#ladybug-body-clip)" fill="#111111">
    <circle cx="-15.3" cy="15.8" r="6.1" />
    <circle cx="5.2" cy="20.1" r="5.5" />
    <circle cx="0.5" cy="-0.8" r="8.2" />
    <circle cx="-20.9" cy="-10.4" r="4.8" />
    <circle cx="10.7" cy="-22.6" r="7.0" />
    <circle cx="-5.4" cy="-25.3" r="5.8" />
    <circle cx="15.1" cy="5.9" r="6.6" />
  </g>
  
  <path 
    fill="#bc332a" 
    fill-rule="evenodd"
    d="M 27.64 18.91 Q 19.81 30.36 6.17 32.92 Q -7.46 35.48 -18.91 27.64 Q -30.36 19.81 -32.92 6.17 Q -35.48 -7.46 -27.64 -18.91 Q -19.81 -30.36 -6.17 -32.92 Q 7.46 -35.48 18.91 -27.64 Q 24.10 -24.10 27.64 -18.91 Q 28.32 -17.92 28.25 -16.73 Q 28.18 -15.54 27.39 -14.63 Q 14.64 0 27.39 14.63 Q 28.18 15.54 28.25 16.73 Q 28.32 17.92 27.64 18.91 L 27.64 18.91 M 21.87 14.96 L 24.76 16.93 L 22.12 19.23 Q 5.35 0 22.12 -19.23 L 24.76 -16.93 L 21.87 -14.96 Q 19.06 -19.06 14.96 -21.87 Q 5.90 -28.06 -4.88 -26.04 Q -15.67 -24.02 -21.87 -14.96 Q -28.06 -5.90 -26.04 4.88 Q -24.02 15.67 -14.96 21.87 Q -5.90 28.06 4.88 26.04 Q 15.67 24.02 21.87 14.96 Z"
  />

</svg>`,
        is_hostile: false,
        range: 100
    },
    soldier_ant: {
        name: "Common Soldier Ant",
        damage: 10,
        health: 100,
        size: 1.0,
        speed: 1.0,
        cooldown: 2000,
        description: "A small, hostile soldier ant that flies aggressively",
        color: "#87CEEB",
        image: `<svg width="32" height="32" viewBox="-40 -35 80 70" xmlns="http://www.w3.org/2000/svg">
  <circle cx="-12" cy="0" r="10" fill="#555555" stroke="#444444" stroke-width="7" />

  <g fill="#eeeeee" fill-opacity="0.5">
    <ellipse cx="0" cy="0" rx="15" ry="7" transform="translate(-11 -8) rotate(18)">
      <animateTransform attributeName="transform"
                        type="rotate"
                        additive="sum"
                        values="0; 3.6; 0"
                        keyTimes="0; 0.5; 1"
                        dur="2s"
                        repeatCount="indefinite"
                        calcMode="spline" keySplines="0.4 0 0.6 1; 0.6 0 0.4 1" />
    </ellipse>
    <ellipse cx="0" cy="0" rx="15" ry="7" transform="translate(-11 8) rotate(-18)">
      <animateTransform attributeName="transform"
                        type="rotate"
                        additive="sum"
                        values="0; -3.6; 0"
                        keyTimes="0; 0.5; 1"
                        dur="2s"
                        repeatCount="indefinite"
                        calcMode="spline" keySplines="0.4 0 0.6 1; 0.6 0 0.4 1" />
    </ellipse>
  </g>

  <path fill="none" stroke="#292929" stroke-width="7" stroke-linecap="round">
    <animate attributeName="d"
             dur="2s"
             repeatCount="indefinite"
             calcMode="spline" keySplines="0.4 0 0.6 1; 0.6 0 0.4 1"
             keyTimes="0; 0.5; 1"
             values="M 4 -7 Q 15 -10 26 -5 M 4 7 Q 15 10 26 5;
                     M 4 -7 Q 15 -9 26 -4 M 4 7 Q 15 9 26 4;
                     M 4 -7 Q 15 -10 26 -5 M 4 7 Q 15 10 26 5" />
  </path>

  <circle cx="4" cy="0" r="14" fill="#555555" stroke="#444444" stroke-width="7" />

</svg>`,
        is_hostile: true,
        range: 100
    },
    rock: {
        name: "Rock",
        damage: 10,
        health: 75,
        size: 1.0,
        speed: 0.0,
        cooldown: 2000,
        description: "A rock that provides basic protection",
        color: "#8B0000",
        image: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <polygon
    points="16,1.4 30.6,12.3 25,29.6 7,29.6 1.4,12.3"
    fill="#777777"
    stroke="#606060"
    stroke-width="2"
    stroke-linecap="round"
  />
</svg>`,
        is_hostile: false,
        range: 100
    }
};
// Rarity-specific overrides for special cases
const RARITY_OVERRIDES = {
    soldier_ant: {
        uncommon: {
            range: 200
        },
        rare: {
            range: 350
        },
        epic: {
            range: 500
        },
        legendary: {
            range: 600
        },
        mythic: {
            range: 750
        },
        ultra: {
            range: 750,
            description: "An ultra soldier ant with cosmic power",
            color: "#de1f65"
        },
        super: {
            range: 750,
            description: "A super soldier ant with divine energy",
            color: "#2bffa4"
        },
        unique: {
            range: 750,
            description: "A unique soldier ant of ultimate power",
            color: "#bf00ff"
        }
    },
    rock: {
        uncommon: {
            name: "Enhanced Rock",
            color: "#32CD32"
        },
        rare: {
            name: "Royal Rock"
        },
        epic: {
            name: "Epic Rock"
        },
        legendary: {
            name: "Legendary Rock"
        },
        mythic: {
            name: "Mythic Rock"
        },
        ultra: {
            name: "Ultra Rock",
            description: "An ultra rock that provides basic protection"
        },
        super: {
            name: "Super Rock",
            description: "A super rock that provides basic protection"
        },
        unique: {
            name: "Unique Rock",
            description: "A unique rock that provides basic protection"
        }
    },
    bee: {
        ultra: {
            description: "An ultra bee with cosmic power",
            color: "#de1f65"
        },
        super: {
            description: "A super bee with divine energy",
            color: "#2bffa4"
        },
        unique: {
            description: "A unique bee of ultimate power",
            color: "#bf00ff"
        }
    },
    ladybug: {
        ultra: {
            description: "An ultra ladybug with cosmic power",
            color: "#de1f65"
        },
        super: {
            description: "A super ladybug with divine energy",
            color: "#2bffa4"
        },
        unique: {
            description: "A unique ladybug of ultimate power",
            color: "#bf00ff"
        }
    }
};
// Rarity color mappings
const RARITY_COLORS = {
    common: "#87CEEB",
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
    rare: "Rare",
    epic: "Epic",
    legendary: "Legendary",
    mythic: "Mythic",
    ultra: "Ultra",
    super: "Super",
    unique: "Unique"
};
// Function to generate mob stats for a specific rarity
function generateMobStats(baseConfig, rarity, mobType) {
    const rarityIndex = exports.RARITY_LEVELS.indexOf(rarity);
    // Calculate scaled stats
    const damage = baseConfig.damage * DAMAGE_SCALING[rarity];
    const health = baseConfig.health * HEALTH_SCALING[rarity];
    // Calculate size scaling using the size scaling table
    const size = baseConfig.size * SIZE_SCALING[rarity];
    // Get XP from the specific mob XP table
    const xp = MOB_XP_TABLES[mobType]?.[rarity] || 1;
    // Get rarity-specific overrides
    const overrides = RARITY_OVERRIDES[mobType]?.[rarity] || {};
    // Generate name with prefix
    const prefix = RARITY_PREFIXES[rarity];
    const name = overrides.name || (prefix ? `${prefix} ${baseConfig.name.replace('Common ', '')}` : baseConfig.name);
    return {
        name,
        damage,
        health,
        size,
        speed: overrides.speed ?? baseConfig.speed,
        cooldown: overrides.cooldown ?? baseConfig.cooldown,
        description: overrides.description ?? baseConfig.description,
        color: overrides.color ?? RARITY_COLORS[rarity],
        image: overrides.image ?? baseConfig.image,
        is_hostile: overrides.is_hostile ?? baseConfig.is_hostile,
        range: overrides.range ?? baseConfig.range,
        xp
    };
}
// Generate the full mob configuration
exports.MOB_CONFIG = {};
// Initialize the mob configuration
for (const mobType in BASE_MOB_CONFIGS) {
    exports.MOB_CONFIG[mobType] = {};
    for (const rarity of exports.RARITY_LEVELS) {
        exports.MOB_CONFIG[mobType][rarity] = generateMobStats(BASE_MOB_CONFIGS[mobType], rarity, mobType);
    }
}
function getMobStats(mobType, rarity) {
    return exports.MOB_CONFIG[mobType]?.[rarity] || null;
}
function getAllMobTypes() {
    return Object.keys(exports.MOB_CONFIG);
}
function getMobRarities(mobType) {
    return Object.keys(exports.MOB_CONFIG[mobType] || {});
}
// Drop table configuration for each mob type
exports.MOB_DROP_TABLES = {
    bee: {
        guaranteed: true, // Bees always drop something
        drops: [
            // Specific drops
            {
                type: 'petal',
                itemType: 'stinger',
                rarity: 'common',
                probability: 0.3, // 30% chance for stinger
                minQuantity: 1,
                maxQuantity: 1
            },
            // Rarity-based drops (50% common, 10% unusual for common mobs)
            {
                type: 'petal',
                itemType: 'basic',
                rarity: 'common',
                probability: 0.5,
                minQuantity: 1,
                maxQuantity: 2
            },
            {
                type: 'petal',
                itemType: 'basic',
                rarity: 'uncommon',
                probability: 0.1,
                minQuantity: 1,
                maxQuantity: 1
            }
        ]
    },
    ladybug: {
        guaranteed: true, // Ladybugs always drop something
        drops: [
            // Specific drops
            {
                type: 'consumable',
                itemType: 'health_potion',
                rarity: 'common',
                probability: 0.4, // 40% chance for health potion
                minQuantity: 1,
                maxQuantity: 1
            },
            // Rarity-based drops
            {
                type: 'petal',
                itemType: 'rose',
                rarity: 'common',
                probability: 0.5,
                minQuantity: 1,
                maxQuantity: 2
            },
            {
                type: 'petal',
                itemType: 'rose',
                rarity: 'uncommon',
                probability: 0.1,
                minQuantity: 1,
                maxQuantity: 1
            },
            {
                type: 'petal',
                itemType: 'light',
                rarity: 'common',
                probability: 0.5,
                minQuantity: 1,
                maxQuantity: 1
            },
            // Yggdrasil petal drops (rare)
            {
                type: 'petal',
                itemType: 'yggdrasil',
                rarity: 'common',
                probability: 0.05, // 5% chance for common yggdrasil
                minQuantity: 1,
                maxQuantity: 1
            },
            {
                type: 'petal',
                itemType: 'yggdrasil',
                rarity: 'uncommon',
                probability: 0.002, // 0.2% chance for uncommon yggdrasil
                minQuantity: 1,
                maxQuantity: 1
            },
            {
                type: 'petal',
                itemType: 'yggdrasil',
                rarity: 'rare',
                probability: 0.002, // 0.2% chance for rare yggdrasil
                minQuantity: 1,
                maxQuantity: 1
            },
            {
                type: 'petal',
                itemType: 'yggdrasil',
                rarity: 'epic',
                probability: 0.001, // 0.1% chance for epic yggdrasil
                minQuantity: 1,
                maxQuantity: 1
            },
            {
                type: 'petal',
                itemType: 'yggdrasil',
                rarity: 'legendary',
                probability: 0.0005, // 0.05% chance for legendary yggdrasil
                minQuantity: 1,
                maxQuantity: 1
            },
            {
                type: 'petal',
                itemType: 'yggdrasil',
                rarity: 'mythic',
                probability: 0.0002, // 0.02% chance for mythic yggdrasil
                minQuantity: 1,
                maxQuantity: 1
            },
            {
                type: 'petal',
                itemType: 'yggdrasil',
                rarity: 'ultra',
                probability: 0.0001, // 0.01% chance for ultra yggdrasil
                minQuantity: 1,
                maxQuantity: 1
            },
            {
                type: 'petal',
                itemType: 'yggdrasil',
                rarity: 'super',
                probability: 0.00005, // 0.005% chance for super yggdrasil
                minQuantity: 1,
                maxQuantity: 1
            },
            {
                type: 'petal',
                itemType: 'yggdrasil',
                rarity: 'unique',
                probability: 0.00001, // 0.001% chance for unique yggdrasil
                minQuantity: 1,
                maxQuantity: 1
            },
        ]
    },
    soldier_ant: {
        guaranteed: true, // Soldier ants always drop something
        drops: [
            // Specific drops
            {
                type: 'consumable',
                itemType: 'speed_boost',
                rarity: 'common',
                probability: 0.4, // 40% chance for basic petal
                minQuantity: 1,
                maxQuantity: 2
            },
            // Rarity-based drops
            {
                type: 'consumable',
                itemType: 'shield',
                rarity: 'common',
                probability: 0.5,
                minQuantity: 1,
                maxQuantity: 2
            },
            {
                type: 'petal',
                itemType: 'basic',
                rarity: 'uncommon',
                probability: 0.1,
                minQuantity: 1,
                maxQuantity: 1
            }
        ]
    },
    rock: {
        guaranteed: true, // Rock always drop something
        drops: [
            // Specific drops
            {
                type: 'petal',
                itemType: 'rock',
                rarity: 'common',
                probability: 0.4, // 40% chance for rock
                minQuantity: 1,
                maxQuantity: 1
            },
            {
                type: 'petal',
                itemType: 'sand',
                rarity: 'common',
                probability: 0.6, // 60% chance for sand (higher since it's a rock mob)
                minQuantity: 1,
                maxQuantity: 3
            }
        ]
    }
};
// Function to calculate drops for a mob based on its rarity
function calculateMobDrops(mobType, mobRarity) {
    const dropTable = exports.MOB_DROP_TABLES[mobType];
    if (!dropTable) {
        return [];
    }
    const drops = [];
    // For non-common mobs, adjust rarity probabilities
    if (mobRarity !== 'common') {
        const rarityIndex = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'ultra', 'super', 'unique'].indexOf(mobRarity);
        // Process each drop in the table
        for (const drop of dropTable.drops) {
            let adjustedDrop = { ...drop };
            // Adjust rarity based on mob rarity
            // if (drop.type === 'petal') {
            // 90% chance for one rarity lower, 10% chance for same rarity
            const random = Math.random();
            if (random < 0.9 && rarityIndex > 0) {
                // One rarity lower
                const lowerRarityIndex = rarityIndex - 1;
                adjustedDrop.rarity = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'ultra', 'super', 'unique'][lowerRarityIndex];
            }
            // Otherwise keep same rarity (10% chance)
            // }
            console.log('adjustedDrop', adjustedDrop);
            // Check if this drop should occur
            if (Math.random() < adjustedDrop.probability) {
                drops.push(adjustedDrop);
            }
        }
        if (drops.length === 0 && dropTable.guaranteed) {
            drops.push({
                type: dropTable.drops[0].type,
                itemType: dropTable.drops[0].itemType,
                rarity: ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'ultra', 'super', 'unique'][rarityIndex - 1],
                probability: 1.0,
            });
        }
    }
    else {
        // For common mobs, use original probabilities
        for (const drop of dropTable.drops) {
            if (Math.random() < drop.probability) {
                drops.push(drop);
            }
        }
    }
    return drops;
}
// Function to get drop table for a specific mob type
function getMobDropTable(mobType) {
    return exports.MOB_DROP_TABLES[mobType] || null;
}
// Test function to verify drop system
function testDropSystem() {
    console.log('Testing drop system...');
    const mobTypes = ['bee', 'ladybug', 'soldier_ant'];
    const rarities = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'ultra', 'super', 'unique'];
    for (const mobType of mobTypes) {
        console.log(`\nTesting ${mobType}:`);
        for (const rarity of rarities) {
            const drops = calculateMobDrops(mobType, rarity);
            console.log(`  ${rarity}: ${drops.length} drops`);
            for (const drop of drops) {
                console.log(`    - ${drop.type} ${drop.itemType} (${drop.rarity})`);
            }
        }
    }
}
