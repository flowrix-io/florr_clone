"use strict";
// Mob drop table data and calculation logic — extracted from mobs.ts for file-size management.
Object.defineProperty(exports, "__esModule", { value: true });
exports.MOB_DROP_TABLES = void 0;
exports.calculateMobDrops = calculateMobDrops;
const mob_configs_1 = require("./mob_configs");
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
                itemType: 'faster',
                rarity: 'common',
                probability: 0.5,
                minQuantity: 1,
                maxQuantity: 1
            },
            {
                type: 'petal',
                itemType: 'pollen',
                rarity: 'common',
                probability: 0.8,
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
                maxQuantity: 1
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
            }
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
                maxQuantity: 1
            },
            // Rarity-based drops
            {
                type: 'consumable',
                itemType: 'shield',
                rarity: 'common',
                probability: 0.5,
                minQuantity: 1,
                maxQuantity: 1
            },
            {
                type: 'petal',
                itemType: 'glass',
                rarity: 'common',
                probability: 0.8,
                minQuantity: 1,
                maxQuantity: 1
            },
            {
                type: 'petal',
                itemType: 'clover',
                rarity: 'common',
                probability: 0.1,
                minQuantity: 1,
                maxQuantity: 1
            },
            {
                type: 'petal',
                itemType: 'clover',
                rarity: 'uncommon',
                probability: 0.1,
                minQuantity: 1,
                maxQuantity: 1
            },
        ]
    },
    worker_ant: {
        guaranteed: true,
        drops: [
            {
                type: 'petal',
                itemType: 'corn',
                rarity: 'common',
                probability: 0.4,
                minQuantity: 1,
                maxQuantity: 1
            },
            {
                type: 'petal',
                itemType: 'leaf',
                rarity: 'common',
                probability: 0.4,
                minQuantity: 1,
                maxQuantity: 1
            },
        ]
    },
    baby_ant: {
        guaranteed: true,
        drops: [
            {
                type: 'petal',
                itemType: 'light',
                rarity: 'common',
                probability: 0.4,
                minQuantity: 1,
                maxQuantity: 1
            },
            {
                type: 'petal',
                itemType: 'leaf',
                rarity: 'common',
                probability: 0.4,
                minQuantity: 1,
                maxQuantity: 1
            }
        ]
    },
    ant_hole: {
        guaranteed: false,
        drops: [
            {
                type: 'petal',
                itemType: 'soil',
                rarity: 'uncommon',
                probability: 0.5,
                minQuantity: 1,
                maxQuantity: 1
            },
            {
                type: 'petal',
                itemType: 'soldier_ant_egg',
                rarity: 'common',
                probability: 0.4,
                minQuantity: 1,
                maxQuantity: 10
            }
        ]
    },
    fire_ant_hole: {
        guaranteed: false,
        drops: [
            {
                type: 'petal',
                itemType: 'magnet',
                rarity: 'common',
                probability: 0.4,
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
            }
        ]
    },
    dandelion: {
        guaranteed: true, // Dandelion always drop something
        drops: [
            // Specific drops
            {
                type: 'petal',
                itemType: 'dandelion',
                rarity: 'uncommon',
                probability: 0.4, // 40% chance for dandelion
                minQuantity: 1,
                maxQuantity: 1
            }
        ]
    },
    soldier_fire_ant: {
        guaranteed: true,
        drops: [
            {
                type: 'petal',
                itemType: 'bone',
                rarity: 'common',
                probability: 0.4, // 40% chance for bone
                minQuantity: 1,
                maxQuantity: 1
            },
            {
                type: 'petal',
                itemType: 'bone',
                rarity: 'uncommon',
                probability: 0.2, // 20% chance for bone
                minQuantity: 1,
                maxQuantity: 1
            },
            {
                type: 'consumable',
                itemType: 'speed_boost',
                rarity: 'common',
                probability: 0.4, // 40% chance for speed boost
                minQuantity: 1,
                maxQuantity: 1
            },
            {
                type: 'petal',
                itemType: 'yucca',
                rarity: 'common',
                probability: 0.4, // 40% chance for yucca
                minQuantity: 1,
                maxQuantity: 1
            },
        ]
    },
    shiny_ladybug: {
        guaranteed: true,
        drops: [
            {
                type: 'petal',
                itemType: 'yggdrasil',
                rarity: 'common',
                probability: 0.4, // 40% chance for rock
                minQuantity: 1,
                maxQuantity: 1
            },
            {
                type: 'petal',
                itemType: 'rose',
                rarity: 'uncommon',
                probability: 0.2, // 20% chance for rose
                minQuantity: 1,
                maxQuantity: 1
            },
            {
                type: 'consumable',
                itemType: 'health_potion',
                rarity: 'common',
                probability: 0.4, // 40% chance for health potion
                minQuantity: 1,
                maxQuantity: 1
            },
            {
                type: 'petal',
                itemType: 'light',
                rarity: 'common',
                probability: 0.5, // 50% chance for light
                minQuantity: 1,
                maxQuantity: 1
            }
        ]
    },
    dark_ladybug: {
        guaranteed: true,
        drops: [
            {
                type: 'petal',
                itemType: 'rose',
                rarity: 'common',
                probability: 0.4, // 40% chance for rose
                minQuantity: 1,
                maxQuantity: 1
            },
            {
                type: 'petal',
                itemType: 'bone',
                rarity: 'common',
                probability: 0.4, // 40% chance for bone
                minQuantity: 1,
                maxQuantity: 1
            },
            {
                type: 'consumable',
                itemType: 'shield',
                rarity: 'common',
                probability: 0.4, // 40% chance for shield
                minQuantity: 1,
                maxQuantity: 1
            },
            {
                type: 'petal',
                itemType: 'yin_yang',
                rarity: 'common',
                probability: 0.1, // 10% chance for yin yang
                minQuantity: 1,
                maxQuantity: 1
            }
        ]
    },
    sandstorm: {
        guaranteed: true,
        drops: [
            {
                type: 'petal',
                itemType: 'sand',
                rarity: 'common',
                probability: 0.4, // 40% chance for sand
                minQuantity: 1,
                maxQuantity: 1
            },
            {
                type: 'petal',
                itemType: 'sand',
                rarity: 'uncommon',
                probability: 0.2, // 20% chance for sand
                minQuantity: 1,
                maxQuantity: 1
            },
            {
                type: 'petal',
                itemType: 'rock',
                rarity: 'common',
                probability: 0.6, // 60% chance for rock
                minQuantity: 1,
                maxQuantity: 1
            },
        ]
    },
    cactus: {
        guaranteed: true,
        drops: [
            {
                type: 'petal',
                itemType: 'cactus',
                rarity: 'common',
                probability: 0.7, // 70% chance for cactus
                minQuantity: 1,
                maxQuantity: 1
            },
            {
                type: 'petal',
                itemType: 'poison_cactus',
                rarity: 'common',
                probability: 0.3, // 40% chance for poison cactus
                minQuantity: 1,
                maxQuantity: 1
            }
        ]
    },
    beetle: {
        guaranteed: true,
        drops: [
            {
                type: 'petal',
                itemType: 'lentil',
                rarity: 'common',
                probability: 0.2, // 40% chance for bone
                minQuantity: 1,
                maxQuantity: 1
            },
            {
                type: 'petal',
                itemType: 'lentil',
                rarity: 'uncommon',
                probability: 0.8, // 20% chance for bone
                minQuantity: 1,
                maxQuantity: 1
            },
            {
                type: 'petal',
                itemType: 'iris',
                rarity: 'common',
                probability: 0.5, // 50% chance for iris
                minQuantity: 1,
                maxQuantity: 1
            },
            {
                type: 'petal',
                itemType: 'iris',
                rarity: 'uncommon',
                probability: 0.1, // 10% chance for iris
                minQuantity: 1,
                maxQuantity: 1
            }
        ]
    },
    hel_beetle: {
        guaranteed: true,
        drops: [
            {
                type: 'petal',
                itemType: 'bone',
                rarity: 'common',
                probability: 0.4, // 40% chance for bone
                minQuantity: 1,
                maxQuantity: 1
            },
            {
                type: 'petal',
                itemType: 'bone',
                rarity: 'uncommon',
                probability: 0.2, // 20% chance for bone
                minQuantity: 1,
                maxQuantity: 1
            },
            {
                type: 'petal',
                itemType: 'blood_leaf',
                rarity: 'common',
                probability: 0.4, // 40% chance for blood leaf
                minQuantity: 1,
                maxQuantity: 1
            },
            {
                type: 'petal',
                itemType: 'blood_leaf',
                rarity: 'uncommon',
                probability: 0.2, // 20% chance for blood leaf
                minQuantity: 1,
                maxQuantity: 1
            }
        ]
    },
    jellyfish: {
        guaranteed: true,
        drops: [
            {
                type: 'petal',
                itemType: 'lightning',
                rarity: 'common',
                probability: 0.4, // 40% chance for lightning
                minQuantity: 1,
                maxQuantity: 1
            },
            {
                type: 'petal',
                itemType: 'lightning',
                rarity: 'uncommon',
                probability: 0.2, // 20% chance for lightning
                minQuantity: 1,
                maxQuantity: 1
            },
            {
                type: 'petal',
                itemType: 'jelly',
                rarity: 'common',
                probability: 0.4, // 40% chance for jelly
                minQuantity: 1,
                maxQuantity: 1
            },
            {
                type: 'petal',
                itemType: 'jelly',
                rarity: 'uncommon',
                probability: 0.2, // 20% chance for jelly
                minQuantity: 1,
                maxQuantity: 1
            }
        ]
    },
    bubble: {
        guaranteed: true,
        drops: [
            {
                type: 'petal',
                itemType: 'bubble',
                rarity: 'common',
                probability: 0.5,
                minQuantity: 1,
                maxQuantity: 1
            },
            {
                type: 'petal',
                itemType: 'air',
                rarity: 'uncommon',
                probability: 0.9,
                minQuantity: 1,
                maxQuantity: 1
            }
        ]
    },
    starfish: {
        guaranteed: true,
        drops: [
            {
                type: 'petal',
                itemType: 'starfish',
                rarity: 'common',
                probability: 1.0,
                minQuantity: 1,
                maxQuantity: 1
            }
        ]
    },
    sponge_1: {
        guaranteed: true,
        drops: [
            {
                type: 'petal',
                itemType: 'sponge',
                rarity: 'common',
                probability: 1.0,
                minQuantity: 1,
                maxQuantity: 1
            }
        ]
    },
    sponge_2: {
        guaranteed: true,
        drops: [
            {
                type: 'petal',
                itemType: 'sponge',
                rarity: 'common',
                probability: 1.0,
                minQuantity: 1,
                maxQuantity: 1
            }
        ]
    },
    hornet: {
        guaranteed: true,
        drops: [
            {
                type: 'petal',
                itemType: 'missile',
                rarity: 'common',
                probability: 1.0,
                minQuantity: 1,
                maxQuantity: 1
            },
            {
                type: 'petal',
                itemType: 'antennae',
                rarity: 'common',
                probability: 0.5,
                minQuantity: 1,
                maxQuantity: 1
            },
        ]
    },
    leafbug: {
        guaranteed: true,
        drops: [
            {
                type: 'petal',
                itemType: 'leaf',
                rarity: 'common',
                probability: 1.0,
                minQuantity: 1,
                maxQuantity: 1
            }
        ]
    },
    bush: {
        guaranteed: true,
        drops: [
            {
                type: 'petal',
                itemType: 'leaf',
                rarity: 'common',
                probability: 0.5,
                minQuantity: 1,
                maxQuantity: 1
            },
            {
                type: 'petal',
                itemType: 'leaf',
                rarity: 'uncommon',
                probability: 0.1,
                minQuantity: 1,
                maxQuantity: 1
            },
            {
                type: 'petal',
                itemType: 'raindrop',
                rarity: 'common',
                probability: 0.4,
                minQuantity: 1,
                maxQuantity: 1
            }
        ]
    },
    mantis: {
        guaranteed: true,
        drops: [
            {
                type: 'petal',
                itemType: 'leaf',
                rarity: 'common',
                probability: 1.0,
                minQuantity: 1,
                maxQuantity: 1
            }
        ]
    },
    fly: {
        guaranteed: true,
        drops: [
            {
                type: 'petal',
                itemType: 'wing',
                rarity: 'common',
                probability: 1.0,
                minQuantity: 1,
                maxQuantity: 1
            }
        ]
    },
    moth: {
        guaranteed: true,
        drops: [
            {
                type: 'petal',
                itemType: 'wing',
                rarity: 'common',
                probability: 1.0,
                minQuantity: 1,
                maxQuantity: 1
            },
            {
                type: 'petal',
                itemType: 'bulb',
                rarity: 'uncommon',
                probability: 0.5,
                minQuantity: 1,
                maxQuantity: 1
            }
        ]
    },
    target_dummy: {
        guaranteed: true,
        drops: [
            {
                type: 'petal',
                itemType: 'square',
                rarity: 'common',
                probability: 1.0,
                minQuantity: 1,
                maxQuantity: 3
            }
        ]
    },
    garbage: {
        guaranteed: true,
        drops: [
            {
                type: 'petal',
                itemType: 'random', // Special marker for random petal
                rarity: 'common',
                probability: 1.0,
                minQuantity: 1,
                maxQuantity: 1
            },
            {
                type: 'petal',
                itemType: 'gas',
                rarity: 'uncommon',
                probability: 0.5,
                minQuantity: 1,
                maxQuantity: 1
            }
        ]
    },
    roach: {
        guaranteed: true,
        drops: [
            {
                type: 'petal',
                itemType: 'golden_leaf',
                rarity: 'common',
                probability: 1.0,
                minQuantity: 1,
                maxQuantity: 1
            },
            {
                type: 'petal',
                itemType: 'faster',
                rarity: 'common',
                probability: 0.5,
                minQuantity: 1,
                maxQuantity: 1
            },
        ]
    },
    spider: {
        guaranteed: true,
        drops: [
            {
                type: 'petal',
                itemType: 'third_eye',
                rarity: 'common',
                probability: 0.05,
                minQuantity: 1,
                maxQuantity: 1
            },
            {
                type: 'consumable',
                itemType: 'speed_boost',
                rarity: 'common',
                probability: 0.99,
                minQuantity: 1,
                maxQuantity: 1
            },
            {
                type: 'petal',
                itemType: 'faster',
                rarity: 'common',
                probability: 0.5,
                minQuantity: 1,
                maxQuantity: 1
            },
        ]
    },
    javascript: {
        guaranteed: true,
        drops: [
            {
                type: 'petal',
                itemType: 'javascript',
                rarity: 'common',
                probability: 1.0,
                minQuantity: 1,
                maxQuantity: 1
            },
            {
                type: 'petal',
                itemType: 'bomb',
                rarity: 'common',
                probability: 0.5,
                minQuantity: 1,
                maxQuantity: 1
            }
        ]
    },
    glitch: {
        guaranteed: true,
        drops: [
            {
                type: 'petal',
                itemType: 'glitch',
                rarity: 'common',
                probability: 1.0,
                minQuantity: 1,
                maxQuantity: 1
            },
            {
                type: 'petal',
                itemType: 'random',
                rarity: 'common',
                probability: 0.5,
                minQuantity: 1,
                maxQuantity: 1
            }
        ]
    },
    desert_centipede: {
        guaranteed: false,
        drops: [
            {
                type: 'petal',
                itemType: 'powder',
                rarity: 'common',
                probability: 0.5,
                minQuantity: 1,
                maxQuantity: 0
            }
        ]
    },
    desert_centipede_body: {
        guaranteed: false,
        drops: [
            {
                type: 'petal',
                itemType: 'powder',
                rarity: 'common',
                probability: 0.5,
                minQuantity: 1,
                maxQuantity: 0
            }
        ]
    },
    centipede: {
        guaranteed: false,
        drops: [
            {
                type: 'petal',
                itemType: 'peas',
                rarity: 'common',
                probability: 0.5,
                minQuantity: 1,
                maxQuantity: 0
            }
        ]
    },
    centipede_body: {
        guaranteed: false,
        drops: [
            {
                type: 'petal',
                itemType: 'peas',
                rarity: 'common',
                probability: 0.5,
                minQuantity: 1,
                maxQuantity: 0
            }
        ]
    },
    sun: {
        guaranteed: true,
        drops: [
            {
                type: 'petal',
                itemType: 'glass',
                rarity: 'common',
                probability: 1.0,
                minQuantity: 1,
                maxQuantity: 1
            },
            {
                type: 'petal',
                itemType: 'rock',
                rarity: 'uncommon',
                probability: 0.5,
                minQuantity: 1,
                maxQuantity: 1
            },
            {
                type: 'petal',
                itemType: 'sand',
                rarity: 'uncommon',
                probability: 0.5,
                minQuantity: 1,
                maxQuantity: 1
            },
            {
                type: 'petal',
                itemType: 'pollen',
                rarity: 'uncommon',
                probability: 0.5,
                minQuantity: 1,
                maxQuantity: 1
            },
            {
                type: 'consumable',
                itemType: 'speed_boost',
                rarity: 'uncommon',
                probability: 0.5,
                minQuantity: 1,
                maxQuantity: 1
            },
            {
                type: 'consumable',
                itemType: 'shield',
                rarity: 'uncommon',
                probability: 0.5,
                minQuantity: 1,
                maxQuantity: 1
            }
        ]
    },
    shell: {
        guaranteed: true,
        drops: [
            {
                type: 'petal',
                itemType: 'magnet',
                rarity: 'common',
                probability: 0.8,
                minQuantity: 1,
                maxQuantity: 1
            }
        ]
    }
};
// Ensure every mob type drops its egg with 100% chance for common rarity
for (const mobType in mob_configs_1.BASE_MOB_CONFIGS) {
    // Skip pet mobs (they end with _pet)
    if (mobType.endsWith('_pet')) {
        continue;
    }
    // Skip mobs with noEggDrop set to true
    if (mob_configs_1.BASE_MOB_CONFIGS[mobType].noEggDrop) {
        continue;
    }
    const eggName = `${mobType}_egg`;
    // Get or create drop table for this mob
    if (!exports.MOB_DROP_TABLES[mobType]) {
        exports.MOB_DROP_TABLES[mobType] = {
            guaranteed: true,
            drops: []
        };
    }
    // Check if egg drop already exists
    const existingEggIndex = exports.MOB_DROP_TABLES[mobType].drops.findIndex(drop => drop.type === 'petal' && drop.itemType === eggName && drop.rarity === 'common');
    if (existingEggIndex >= 0) {
        // Update existing egg drop to 100% probability
        exports.MOB_DROP_TABLES[mobType].drops[existingEggIndex].probability = 1.0;
    }
    else {
        // Add new egg drop with 100% probability for common
        exports.MOB_DROP_TABLES[mobType].drops.unshift({
            type: 'petal',
            itemType: eggName,
            rarity: 'common',
            probability: 1.0,
            minQuantity: 1,
            maxQuantity: 1
        });
    }
}
// Function to calculate drops for a mob based on its rarity
function calculateMobDrops(mobType, mobRarity) {
    const dropTable = exports.MOB_DROP_TABLES[mobType];
    if (!dropTable) {
        return [];
    }
    const drops = [];
    // For non-common mobs, adjust rarity probabilities
    if (mobRarity !== 'common') {
        const rarityIndex = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'ultra', 'super', 'unique', 'apex'].indexOf(mobRarity);
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
                adjustedDrop.rarity = ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'ultra', 'super', 'unique', 'apex'][lowerRarityIndex];
            }
            // Otherwise keep same rarity (10% chance)
            // }
            // Check if this drop should occur
            if (Math.random() < adjustedDrop.probability) {
                drops.push(adjustedDrop);
            }
        }
        if (drops.length === 0 && dropTable.guaranteed) {
            drops.push({
                type: dropTable.drops[0].type,
                itemType: dropTable.drops[0].itemType,
                rarity: ['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic', 'ultra', 'super', 'unique', 'apex'][rarityIndex - 1],
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
