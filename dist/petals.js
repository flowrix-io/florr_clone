"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PETAL_CONFIG = exports.ITEM_RARITY_COLORS = exports.ABSORBING_SKILL_MULTIPLIERS = exports.ABSORB_XP = exports.DEFAULT_SHOP_PRICE = exports.SHOP_PRICES = exports.RARITY_LEVELS = void 0;
exports.getRarityIndex = getRarityIndex;
exports.getShopPrice = getShopPrice;
exports.getLightningDamage = getLightningDamage;
exports.getLightningScalingInfo = getLightningScalingInfo;
exports.getPetalStats = getPetalStats;
exports.getEffectivePetalCooldown = getEffectivePetalCooldown;
exports.getAllPetalTypes = getAllPetalTypes;
exports.isEggPetalType = isEggPetalType;
exports.isUndroppableEggPetalType = isUndroppableEggPetalType;
exports.getDroppablePetalTypes = getDroppablePetalTypes;
exports.getPetalRarities = getPetalRarities;
const mobs_1 = require("./mobs");
const player_1 = require("./player");
const sponge_svg_1 = require("./sponge_svg");
const petals_json_1 = __importDefault(require("./petals.json"));
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
    'unique',
    'apex'
];
function getRarityIndex(rarity) {
    return exports.RARITY_LEVELS.indexOf(rarity);
}
// Shop pricing configuration — base price per petal type, multiplied by rarity.
// Shared by client (to render prices) and server (to validate shopBuy) so the
// two can never drift out of sync.
exports.SHOP_PRICES = {
    basic: 10, rose: 15, stinger: 20, light: 12, rock: 18, sand: 14,
    yggdrasil: 120, dandelion: 13, clover: 16, bone: 17, cactus: 19,
    poison_cactus: 22, iris: 18, lightning: 25, missile: 21, jelly: 20,
    yucca: 15, leaf: 14, cutter: 50, lightning_cutter: 60, wing: 23,
    square: 1000, golden_leaf: 18, blood_leaf: 24, target_dummy_egg: 100000000,
    splitter: 1000000, flower: 3000000, moon: 2000, shell: 15, observer: 75, guided_missile: 30
};
exports.DEFAULT_SHOP_PRICE = 10;
function getShopPrice(petalType, rarity) {
    const basePrice = exports.SHOP_PRICES[petalType] || exports.DEFAULT_SHOP_PRICE;
    const rarityIndex = getRarityIndex(rarity);
    return Math.floor(basePrice * Math.pow(3.5, rarityIndex));
}
// XP granted per petal absorbed in the craft menu's Absorb tab. Roughly half
// the tier-based XP of a same-rarity mob kill (see getXPFromEnemy), so
// absorbing spare drops is a meaningful but not dominant XP source.
exports.ABSORB_XP = {
    common: 5,
    uncommon: 15,
    rare: 45,
    epic: 135,
    legendary: 405,
    mythic: 1215,
    ultra: 3645,
    super: 10935,
    unique: 32805,
    apex: 98415
};
// Per-tier multiplier for the "Absorption" skill talent, applied to ABSORB_XP
// when absorbing petals in the maze. Geometric progression (×~1.26/tier) so
// apex lands on exactly 800% (8x).
exports.ABSORBING_SKILL_MULTIPLIERS = {
    common: 1.0,
    uncommon: 1.26,
    rare: 1.59,
    epic: 2.0,
    legendary: 2.52,
    mythic: 3.17,
    ultra: 4.0,
    super: 5.04,
    unique: 6.35,
    apex: 8.0
};
// Canonical UI rarity colors — single source of truth for all panels/UI
exports.ITEM_RARITY_COLORS = {
    common: '#7eef6d',
    uncommon: '#ffe65d',
    rare: '#4d52e3',
    epic: '#861fde',
    legendary: '#de1f1f',
    mythic: '#1fdbde',
    ultra: '#de1f65',
    super: '#2bffa4',
    unique: '#ffffff',
    apex: '#ff00ff'
};
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
        },
        apex: {
            count: 5
        }
    },
    yggdrasil: {
        common: {
            cooldown: 512000
        },
        uncommon: {
            cooldown: 256000
        },
        rare: {
            cooldown: 128000
        },
        epic: {
            cooldown: 64000
        },
        legendary: {
            cooldown: 32000
        },
        mythic: {
            cooldown: 16000
        },
        ultra: {
            cooldown: 8000
        },
        super: {
            cooldown: 4000
        },
        unique: {
            cooldown: 2000
        },
        apex: {
            cooldown: 1000
        }
    },
    lightning: {
        uncommon: {
            health: 10
        },
        rare: {
            health: 10
        },
        epic: {
            health: 10
        },
        legendary: {
            health: 10
        },
        mythic: {
            health: 10
        },
        ultra: {
            health: 10
        },
        super: {
            health: 10
        },
        unique: {
            health: 10
        },
        apex: {
            health: 10
        }
    },
    jelly: {
        uncommon: {
            knockback: 50.0
        },
        rare: {
            knockback: 100.0
        },
        epic: {
            knockback: 250.0
        },
        legendary: {
            knockback: 500.0
        },
        mythic: {
            knockback: 1800.0
        },
        ultra: {
            knockback: 10000.0
        },
        super: {
            knockback: 25000.0
        },
        unique: {
            knockback: 50000.0
        },
        apex: {
            knockback: 100000.0
        }
    },
    faster: {
        uncommon: {
            playerModifiers: {
                rotationSpeed: 1.2
            }
        },
        rare: {
            playerModifiers: {
                rotationSpeed: 1.3
            }
        },
        epic: {
            playerModifiers: {
                rotationSpeed: 1.4
            }
        },
        legendary: {
            playerModifiers: {
                rotationSpeed: 1.6
            }
        },
        mythic: {
            playerModifiers: {
                rotationSpeed: 1.8
            }
        },
        ultra: {
            playerModifiers: {
                rotationSpeed: 2.1
            }
        },
        super: {
            playerModifiers: {
                rotationSpeed: 2.7
            }
        },
        unique: {
            playerModifiers: {
                rotationSpeed: 3.5
            }
        },
        apex: {
            playerModifiers: {
                rotationSpeed: 4.5
            }
        },
    },
    // Yin Yang just flips rotation direction — it isn't a stacking speed bonus,
    // so every rarity is pinned to the same -1.0 (reversed, same magnitude).
    // Without these overrides the generic rarity scaler (which multiplies the
    // delta from 1.0 by up to ~4.4x at apex) would blow -1.0 out to nearly
    // -8x speed at high rarity.
    yin_yang: {
        uncommon: { playerModifiers: { rotationSpeed: -1.0 } },
        rare: { playerModifiers: { rotationSpeed: -1.0 } },
        epic: { playerModifiers: { rotationSpeed: -1.0 } },
        legendary: { playerModifiers: { rotationSpeed: -1.0 } },
        mythic: { playerModifiers: { rotationSpeed: -1.0 } },
        ultra: { playerModifiers: { rotationSpeed: -1.0 } },
        super: { playerModifiers: { rotationSpeed: -1.0 } },
        unique: { playerModifiers: { rotationSpeed: -1.0 } },
        apex: { playerModifiers: { rotationSpeed: -1.0 } },
    },
    powder: {
        uncommon: {
            playerModifiers: {
                speed: 1.1
            }
        },
        rare: {
            playerModifiers: {
                speed: 1.4
            }
        },
        epic: {
            playerModifiers: {
                speed: 1.6
            }
        },
        legendary: {
            playerModifiers: {
                speed: 1.8
            }
        },
        mythic: {
            playerModifiers: {
                speed: 2.0
            }
        },
        ultra: {
            playerModifiers: {
                speed: 2.2
            }
        },
        super: {
            playerModifiers: {
                speed: 2.4
            }
        },
        unique: {
            playerModifiers: {
                speed: 2.6
            }
        },
        apex: {
            playerModifiers: {
                speed: 2.8
            }
        },
    },
    soil: {
        uncommon: {
            playerModifiers: {
                maxHealth: 1.1,
                playerRadius: 1.05,
                speed: 0.95
            }
        },
        rare: {
            playerModifiers: {
                maxHealth: 1.2,
                playerRadius: 1.1,
                speed: 0.9
            }
        },
        epic: {
            playerModifiers: {
                maxHealth: 1.3,
                playerRadius: 1.2,
                speed: 0.85
            }
        },
        legendary: {
            playerModifiers: {
                maxHealth: 1.4,
                playerRadius: 1.3,
                speed: 0.8
            }
        },
        mythic: {
            playerModifiers: {
                maxHealth: 1.5,
                playerRadius: 1.4,
                speed: 0.75
            }
        },
        ultra: {
            playerModifiers: {
                maxHealth: 1.6,
                playerRadius: 1.5,
                speed: 0.7
            }
        },
        super: {
            playerModifiers: {
                maxHealth: 1.7,
                playerRadius: 1.6,
                speed: 0.65
            }
        },
        unique: {
            playerModifiers: {
                maxHealth: 1.8,
                playerRadius: 1.7,
                speed: 0.6
            }
        },
        apex: {
            playerModifiers: {
                maxHealth: 1.9,
                playerRadius: 1.8,
                speed: 0.6
            }
        }
    },
    clover: {
        uncommon: {
            playerModifiers: { luck: 0.12 }
        },
        rare: {
            playerModifiers: { luck: 0.17 }
        },
        epic: {
            playerModifiers: { luck: 0.24 }
        },
        legendary: {
            playerModifiers: { luck: 0.35 }
        },
        mythic: {
            playerModifiers: { luck: 0.5 }
        },
        ultra: {
            playerModifiers: { luck: 0.72 }
        },
        super: {
            playerModifiers: { luck: 1.04 }
        },
        unique: {
            playerModifiers: { luck: 1.5 }
        },
        apex: {
            playerModifiers: { luck: 2 }
        }
    },
    air: {
        uncommon: {
            playerModifiers: { playerRadius: 1.2 },
        },
        rare: {
            playerModifiers: { playerRadius: 1.6 },
        },
        epic: {
            playerModifiers: { playerRadius: 1.8 },
        },
        legendary: {
            playerModifiers: { playerRadius: 2.0 },
        },
        mythic: {
            playerModifiers: { playerRadius: 2.2 },
        },
        ultra: {
            playerModifiers: { playerRadius: 2.4 },
        },
        super: {
            playerModifiers: { playerRadius: 2.6 },
        },
        unique: {
            playerModifiers: { playerRadius: 2.8 },
        },
        apex: {
            playerModifiers: { playerRadius: 3.0 },
        }
    },
    // Lentil scales attraction force and radius linearly from 1x (common) to 5x (apex):
    //   multiplier(i) = 1 + (i / 9) * 4, where i is the rarity index (0..9).
    // Common values are 2000 force / 20 radius (defined in BASE_PETAL_CONFIGS).
    lentil: {
        uncommon: {
            attractionForce: 2889,
            playerModifiers: { petalAttractionRadius: 29 },
        },
        rare: {
            attractionForce: 3778,
            playerModifiers: { petalAttractionRadius: 38 },
        },
        epic: {
            attractionForce: 4667,
            playerModifiers: { petalAttractionRadius: 47 },
        },
        legendary: {
            attractionForce: 5556,
            playerModifiers: { petalAttractionRadius: 56 },
        },
        mythic: {
            attractionForce: 6444,
            playerModifiers: { petalAttractionRadius: 64 },
        },
        ultra: {
            attractionForce: 7333,
            playerModifiers: { petalAttractionRadius: 73 },
        },
        super: {
            attractionForce: 8222,
            playerModifiers: { petalAttractionRadius: 82 },
        },
        unique: {
            attractionForce: 9111,
            playerModifiers: { petalAttractionRadius: 91 },
        },
        apex: {
            attractionForce: 10000,
            playerModifiers: { petalAttractionRadius: 100 },
        },
    },
    pollen: {
        uncommon: {
            count: 2
        },
        rare: {
            count: 2,
        },
        epic: {
            count: 2,
        },
        legendary: {
            count: 3,
        },
        mythic: {
            count: 3,
        },
        ultra: {
            count: 5,
        },
        super: {
            count: 5,
        },
        unique: {
            count: 5,
        },
        apex: {
            count: 7,
        }
    }
};
/**
 * The petal table itself lives in src/petals.json — one JSON object keyed by
 * petal type, each value a common-rarity BasePetalConfig. RARITY_OVERRIDES above
 * stays in TypeScript: it is the exception list, small enough to read next to
 * the types it patches.
 *
 * Two things JSON cannot express are restored here on startup:
 *  - the shared sponge artwork, carried as a `$sponge:` palette marker (see
 *    sponge_svg.ts) rather than inlined a third time;
 *  - equipFlags, written as an EquipmentFlags member name so the config stays
 *    legible; an unknown name is a hard error rather than a silent 0.
 */
const BASE_PETAL_CONFIGS = petals_json_1.default;
for (const [petalType, config] of Object.entries(BASE_PETAL_CONFIGS)) {
    if (config.image !== undefined)
        config.image = (0, sponge_svg_1.resolveSpongeImage)(config.image);
    if (config.equipFlags !== undefined) {
        const flagName = config.equipFlags;
        const flag = player_1.EquipmentFlags[flagName];
        if (typeof flag !== 'number') {
            throw new Error(`petals.json: ${petalType} has unknown equipFlags "${String(flagName)}"`);
        }
        config.equipFlags = flag;
    }
}
// Helper function to darken a hex color for egg stroke
function darkenColor(hex, factor = 0.7) {
    // Remove # if present
    hex = hex.replace('#', '');
    // Parse RGB values
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    // Darken by factor (0.7 = 70% of original brightness)
    const darkenedR = Math.floor(r * factor);
    const darkenedG = Math.floor(g * factor);
    const darkenedB = Math.floor(b * factor);
    // Convert back to hex
    return `#${darkenedR.toString(16).padStart(2, '0')}${darkenedG.toString(16).padStart(2, '0')}${darkenedB.toString(16).padStart(2, '0')}`;
}
// Helper function to generate an egg SVG based on mob color
function generateEggSVG(mobColor) {
    const strokeColor = darkenColor(mobColor, 0.7);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle r="13" cx="16" cy="16" fill="${mobColor}" stroke="${strokeColor}" stroke-width="4"/>
</svg>`;
}
// Auto-generate eggs for all mobs that don't have them
for (const mobType in mobs_1.BASE_MOB_CONFIGS) {
    // Skip pet mobs (they end with _pet)
    if (mobType.endsWith('_pet')) {
        continue;
    }
    const eggName = `${mobType}_egg`;
    // Skip if egg already exists
    if (BASE_PETAL_CONFIGS[eggName]) {
        continue;
    }
    // Get mob config to extract color
    const mobConfig = mobs_1.BASE_MOB_CONFIGS[mobType];
    if (!mobConfig) {
        continue;
    }
    // Determine pet mob type (check if there's a _pet version, otherwise use the mob type itself)
    const petMobType = mobs_1.BASE_MOB_CONFIGS[`${mobType}_pet`] ? `${mobType}_pet` : mobType;
    // Create the egg config
    BASE_PETAL_CONFIGS[eggName] = {
        name: `${mobConfig.name} Egg`,
        damage: 10,
        health: 10,
        size: 1.0,
        cooldown: 5000,
        description: `A petal that spawns a ${mobConfig.name.toLowerCase()} pet`,
        color: "#000000",
        count: 1,
        petMobType: petMobType,
        petMobRarity: "common",
        image: generateEggSVG(mobConfig.color),
        isAdminPetal: false
    };
}
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
    unique: "#ffffff",
    apex: "#ff00ff"
};
// Rarity name prefixes
const RARITY_PREFIXES = {
    common: "",
    uncommon: "",
    rare: "",
    epic: "",
    legendary: "",
    mythic: "",
    ultra: "",
    super: "",
    unique: "",
    apex: ""
};
// Lightning damage scaling table by rarity
// Shows how lightning damage scales with the 3x multiplier per rarity level
// 
// Usage Examples:
// - Common lightning petal with base damage 10: 10 damage
// - Uncommon lightning petal with base damage 10: 30 damage  
// - Rare lightning petal with base damage 10: 90 damage
// - Epic lightning petal with base damage 10: 270 damage
// - Legendary lightning petal with base damage 10: 810 damage
// - Mythic lightning petal with base damage 10: 2,430 damage
// - Ultra lightning petal with base damage 10: 7,290 damage
// - Super lightning petal with base damage 10: 21,870 damage
// - Unique lightning petal with base damage 10: 65,610 damage
//
// Formula: Final Damage = Base Damage × (3^rarity_index)
const LIGHTNING_SCALING_TABLE = {
    common: { multiplier: 1, damageAt10Base: 10, damageAt25Base: 25, damageAt50Base: 50 },
    uncommon: { multiplier: 3, damageAt10Base: 30, damageAt25Base: 75, damageAt50Base: 150 },
    rare: { multiplier: 9, damageAt10Base: 90, damageAt25Base: 225, damageAt50Base: 450 },
    epic: { multiplier: 27, damageAt10Base: 270, damageAt25Base: 675, damageAt50Base: 1350 },
    legendary: { multiplier: 81, damageAt10Base: 810, damageAt25Base: 2025, damageAt50Base: 4050 },
    mythic: { multiplier: 243, damageAt10Base: 2430, damageAt25Base: 6075, damageAt50Base: 12150 },
    ultra: { multiplier: 729, damageAt10Base: 7290, damageAt25Base: 18225, damageAt50Base: 36450 },
    super: { multiplier: 2187, damageAt10Base: 21870, damageAt25Base: 54675, damageAt50Base: 109350 },
    unique: { multiplier: 6561, damageAt10Base: 65610, damageAt25Base: 164025, damageAt50Base: 328050 },
    apex: { multiplier: 19683, damageAt10Base: 196830, damageAt25Base: 492075, damageAt50Base: 984150 }
};
// Helper function to get lightning damage for a given base damage and rarity
function getLightningDamage(baseDamage, rarity) {
    const scaling = LIGHTNING_SCALING_TABLE[rarity];
    return baseDamage * scaling.multiplier;
}
// Helper function to get lightning scaling info for a rarity
function getLightningScalingInfo(rarity) {
    return LIGHTNING_SCALING_TABLE[rarity];
}
// Example usage:
// const epicLightningDamage = getLightningDamage(25, 'epic'); // Returns 675 (25 × 27)
// const scalingInfo = getLightningScalingInfo('legendary'); // Returns multiplier: 81, damageAt10Base: 810, etc.
// Function to find SVG fallback for higher rarities
function findSvgFallback(petalType, rarity) {
    const rarityIndex = getRarityIndex(rarity);
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
    const rarityIndex = getRarityIndex(rarity);
    const multiplier = Math.pow(3, rarityIndex); // 3x multiplier for each rarity level
    const prefix = RARITY_PREFIXES[rarity];
    const name = prefix ? `${prefix} ${baseConfig.name}` : baseConfig.name;
    // Get rarity-specific overrides
    const overrides = RARITY_OVERRIDES[petalType]?.[rarity] || {};
    // Special handling for yggdrasil - always 1 damage and 1 health
    let damage = baseConfig.damage * multiplier;
    let health = baseConfig.health * multiplier;
    let poison = baseConfig.poison ? baseConfig.poison * multiplier : undefined; // Scale poison with rarity
    // Scale passiveHeal: x3 per rarity up to mythic, then x sqrt(3) per rarity up to apex
    const mythicIndex = getRarityIndex('mythic');
    const passiveHealMultiplier = rarityIndex <= mythicIndex
        ? Math.pow(3, rarityIndex)
        : Math.pow(3, mythicIndex) * Math.pow(Math.sqrt(3), rarityIndex - mythicIndex);
    let passiveHeal = baseConfig.passiveHeal ? baseConfig.passiveHeal * passiveHealMultiplier : undefined;
    // burstHeal follows the same curve as passiveHeal
    const burstHeal = baseConfig.burstHeal ? baseConfig.burstHeal * passiveHealMultiplier : undefined;
    let cooldown = baseConfig.cooldown;
    if (petalType === 'yggdrasil') {
        damage = 1;
        health = 1;
        cooldown = overrides.cooldown ?? baseConfig.cooldown;
    }
    else {
        // Apply overrides for other petals
        damage = overrides.damage ?? damage;
        health = overrides.health ?? health;
        poison = overrides.poison ?? poison; // Apply override or use scaled value
        // Note: passiveHeal doesn't have overrides, it's always scaled from base
        cooldown = overrides.cooldown ?? cooldown;
    }
    // Scale player modifiers with rarity if they exist
    // Modifiers scale linearly from 1x (common) to 4x (unique)
    // Formula: 1 + (rarityIndex / 8) * 3
    let playerModifiers = undefined;
    if (baseConfig.playerModifiers || overrides.playerModifiers) {
        const baseModifiers = baseConfig.playerModifiers || {};
        const overrideModifiers = overrides.playerModifiers || {};
        // Calculate rarity scaling multiplier for player modifiers
        // common (0): 1.0x, unique (8): 4.0x
        const modifierRarityMultiplier = 1 + (rarityIndex / 8) * 3;
        // For modifiers, we can either:
        // 1. Use override if provided (for rarity-specific scaling) - overrides are NOT scaled
        // 2. Scale base modifiers by rarity multiplier
        if (overrideModifiers.damage !== undefined || overrideModifiers.maxHealth !== undefined || overrideModifiers.speed !== undefined || overrideModifiers.range !== undefined || overrideModifiers.rotationSpeed !== undefined || overrideModifiers.playerRadius !== undefined || overrideModifiers.magnetism !== undefined || overrideModifiers.luck !== undefined || overrideModifiers.petalAttractionRadius !== undefined || overrideModifiers.aggroRadius !== undefined || overrideModifiers.poisonArmor !== undefined) {
            // Use override modifiers directly (not scaled, as they're already rarity-specific)
            playerModifiers = {
                damage: overrideModifiers.damage ?? baseModifiers.damage,
                maxHealth: overrideModifiers.maxHealth ?? baseModifiers.maxHealth,
                speed: overrideModifiers.speed ?? baseModifiers.speed,
                range: overrideModifiers.range ?? baseModifiers.range,
                rotationSpeed: overrideModifiers.rotationSpeed ?? baseModifiers.rotationSpeed,
                playerRadius: overrideModifiers.playerRadius ?? baseModifiers.playerRadius,
                magnetism: overrideModifiers.magnetism ?? baseModifiers.magnetism,
                luck: overrideModifiers.luck ?? baseModifiers.luck,
                petalAttractionRadius: overrideModifiers.petalAttractionRadius ?? baseModifiers.petalAttractionRadius,
                aggroRadius: overrideModifiers.aggroRadius ?? baseModifiers.aggroRadius,
                poisonArmor: overrideModifiers.poisonArmor ?? baseModifiers.poisonArmor
            };
        }
        else if (baseModifiers.damage !== undefined || baseModifiers.maxHealth !== undefined || baseModifiers.speed !== undefined || baseModifiers.range !== undefined || baseModifiers.rotationSpeed !== undefined || baseModifiers.playerRadius !== undefined || baseModifiers.magnetism !== undefined || baseModifiers.luck !== undefined || baseModifiers.petalAttractionRadius !== undefined || baseModifiers.aggroRadius !== undefined || baseModifiers.poisonArmor !== undefined) {
            // Scale base modifiers by rarity multiplier
            // Formula: baseValue * (1 + (rarityIndex / 8) * 3)
            // This scales from 1x at common to 4x at unique
            playerModifiers = {
                damage: baseModifiers.damage !== undefined
                    ? 1 + (baseModifiers.damage - 1) * modifierRarityMultiplier
                    : undefined,
                maxHealth: baseModifiers.maxHealth !== undefined
                    ? 1 + (baseModifiers.maxHealth - 1) * modifierRarityMultiplier
                    : undefined,
                speed: baseModifiers.speed !== undefined
                    ? 1 + (baseModifiers.speed - 1) * modifierRarityMultiplier
                    : undefined,
                range: baseModifiers.range !== undefined
                    ? 1 + (baseModifiers.range - 1) * modifierRarityMultiplier
                    : undefined,
                rotationSpeed: baseModifiers.rotationSpeed !== undefined
                    ? 1 + (baseModifiers.rotationSpeed - 1) * modifierRarityMultiplier
                    : undefined,
                playerRadius: baseModifiers.playerRadius !== undefined
                    ? 1 + (baseModifiers.playerRadius - 1) * modifierRarityMultiplier
                    : undefined,
                magnetism: baseModifiers.magnetism !== undefined
                    ? baseModifiers.magnetism * modifierRarityMultiplier
                    : undefined,
                luck: baseModifiers.luck !== undefined
                    ? baseModifiers.luck * modifierRarityMultiplier
                    : undefined,
                petalAttractionRadius: baseModifiers.petalAttractionRadius !== undefined
                    ? baseModifiers.petalAttractionRadius * modifierRarityMultiplier
                    : undefined,
                aggroRadius: baseModifiers.aggroRadius !== undefined
                    ? baseModifiers.aggroRadius * modifierRarityMultiplier
                    : undefined,
                poisonArmor: baseModifiers.poisonArmor !== undefined
                    ? baseModifiers.poisonArmor * modifierRarityMultiplier
                    : undefined
            };
        }
        // Poison armor is the one modifier measured in damage-per-second rather
        // than as a ratio, so it has to ride the DAMAGE curve (3x per rarity)
        // instead of the gentle 1x..4x one the ratio modifiers use. Mob poison
        // scales with DAMAGE_SCALING, so on the modifier curve a lotus that fully
        // negates a common evil centipede absorbs under 2% of a mythic one's bite.
        // Explicit per-rarity overrides stay literal, as everywhere else.
        if (playerModifiers
            && overrideModifiers.poisonArmor === undefined
            && baseModifiers.poisonArmor !== undefined) {
            playerModifiers.poisonArmor = baseModifiers.poisonArmor * multiplier;
        }
    }
    return {
        name,
        damage,
        health,
        size: baseConfig.size, // Size stays the same for each petal type
        speed: baseConfig.speed ?? 1.0, // Default speed
        cooldown,
        knockback: overrides.knockback ?? baseConfig.knockback ?? 5, // Apply override or use base config or default
        poison: poison, // Scaled poison damage per millisecond
        poisonDuration: overrides.poisonDuration ?? baseConfig.poisonDuration, // Poison duration in milliseconds
        description: overrides.description ?? baseConfig.description,
        color: RARITY_COLORS[rarity],
        image: overrides.image ?? baseConfig.image ?? findSvgFallback(petalType, rarity),
        count: overrides.count ?? baseConfig.count,
        passiveHeal: passiveHeal, // Scaled passive healing per second
        burstHeal: burstHeal, // Scaled one-shot heal delivered when the petal is consumed
        burstHealChargeMs: baseConfig.burstHealChargeMs,
        defendOnly: baseConfig.defendOnly,
        isAdminPetal: baseConfig.isAdminPetal ?? false,
        range: baseConfig.range ?? 1.0, // Default range multiplier
        projectile: baseConfig.projectile, // Include projectile config if present
        playerModifiers: playerModifiers, // Include player modifiers if present
        attractionForce: overrides.attractionForce ?? baseConfig.attractionForce,
        petMobType: baseConfig.petMobType, // Include pet mob type if present
        petMobRarity: baseConfig.petMobRarity, // Include pet mob rarity if present
        petCount: baseConfig.petCount,
        slowFactor: baseConfig.slowFactor,
        // A stall gets longer with rarity as well as harder (the strength side
        // is the rarity-vs-rarity contest in applySlow/stallPower). Same gentle
        // 1x..4x curve the ratio player-modifiers use, so an apex pincer holds a
        // mob for ~4x as long as a common one rather than 3^9 times as long.
        slowDuration: baseConfig.slowDuration !== undefined
            ? baseConfig.slowDuration * (1 + (rarityIndex / 8) * 3)
            : undefined,
        // The web field grows with rarity (gardn steps 100 -> 200 from Web to
        // Large Web); same 1x..~2.2x curve, so unique lands just under 200.
        webRadius: baseConfig.webRadius !== undefined
            ? baseConfig.webRadius * (1 + (rarityIndex / 8) * 1.2)
            : undefined,
        radiation: baseConfig.radiation,
        // burstShield follows the same curve as burstHeal
        burstShield: baseConfig.burstShield ? baseConfig.burstShield * passiveHealMultiplier : undefined,
        fixedDirection: overrides.fixedDirection ?? baseConfig.fixedDirection,
        visualOffsetX: overrides.visualOffsetX ?? baseConfig.visualOffsetX,
        visualOffsetY: overrides.visualOffsetY ?? baseConfig.visualOffsetY,
        damageCooldown: overrides.damageCooldown ?? baseConfig.damageCooldown,
        spongeDamageDuration: baseConfig.spongeDamageDuration !== undefined
            ? (overrides.spongeDamageDuration ?? baseConfig.spongeDamageDuration * (1 + rarityIndex * 0.5))
            : undefined,
        faceFlags: baseConfig.faceFlags,
        equipFlags: baseConfig.equipFlags,
        noPhysics: baseConfig.noPhysics,
        clumped: overrides.clumped ?? baseConfig.clumped,
        independentHealth: baseConfig.independentHealth,
        wallCollide: baseConfig.wallCollide,
        emissive: overrides.emissive ?? baseConfig.emissive,
        lightRadius: overrides.lightRadius ?? baseConfig.lightRadius,
        lightColor: overrides.lightColor ?? baseConfig.lightColor,
        cameraZoom: baseConfig.cameraZoom !== undefined
            // Same shape as multiplicative playerModifiers (range/damage/etc.):
            // delta from 1 widens 1x at common to 4x at unique. Floor at 0.3 so
            // higher rarities can't invert the camera or zoom past a sane limit.
            ? Math.max(0.3, 1 + (baseConfig.cameraZoom - 1) * (1 + (rarityIndex / 8) * 3))
            : undefined,
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
// Register all petal types for compact inventory encoding
const inventoryCodec_1 = require("./inventoryCodec");
(0, inventoryCodec_1.initInventoryCodec)(exports.RARITY_LEVELS, Object.keys(exports.PETAL_CONFIG));
function getPetalStats(petalType, rarity) {
    return exports.PETAL_CONFIG[petalType]?.[rarity] || null;
}
/**
 * Reload time for a broken petal, in ms. SHARED server+client: the server times
 * the restore with it, the loadout bar sweeps its reload wedge with it. Keep it
 * that way — a client-side guess (it used to hardcode 10s for every petal) makes
 * the wedge finish nowhere near when the petal actually comes back.
 *
 * `stats` is optional purely to save the caller a second lookup when it already
 * has them.
 */
function getEffectivePetalCooldown(petalType, rarity, stats) {
    const s = stats ?? (petalType ? getPetalStats(petalType, rarity || 'common') : null);
    let cooldown = s?.cooldown || 10000;
    // Bubble reloads faster the rarer it is — the one petal whose reload isn't
    // just its stat block.
    if (petalType === 'bubble' && rarity) {
        const rarityIdx = Math.max(0, getRarityIndex(rarity));
        cooldown = Math.max(50, cooldown * Math.pow(0.85, rarityIdx));
    }
    return cooldown;
}
function getAllPetalTypes() {
    return Object.keys(exports.PETAL_CONFIG);
}
function isEggPetalType(petalType) {
    return petalType.endsWith('_egg');
}
function isUndroppableEggPetalType(petalType) {
    if (!isEggPetalType(petalType))
        return false;
    const mobType = petalType.slice(0, -'_egg'.length);
    return mobs_1.BASE_MOB_CONFIGS[mobType]?.noEggDrop === true;
}
/**
 * The petal types a random roll is allowed to hand out — mob drops, the item
 * spawner, and the ring of petals the spawner renders all draw from this ONE
 * list. Excluded: admin/test petals, eggs for mobs marked `noEggDrop`, and the
 * cutters (body-damage petals that were never meant to drop). Keeping the rule
 * in one place is the point: the item spawner used to re-derive it and only
 * checked `isAdminPetal`, so it happily spawned no-egg eggs and cutters that
 * nothing else in the game would ever give out.
 */
let cachedDroppablePetalTypes = null;
function getDroppablePetalTypes() {
    if (cachedDroppablePetalTypes === null) {
        cachedDroppablePetalTypes = getAllPetalTypes().filter(petalType => {
            if (isUndroppableEggPetalType(petalType))
                return false;
            if (petalType === 'cutter' || petalType === 'lightning_cutter')
                return false;
            // A petal is admin-only if ANY of its rarities says so — checking
            // just 'common' would miss a type whose common tier is absent or
            // left unflagged.
            const rarities = exports.PETAL_CONFIG[petalType];
            if (!rarities)
                return false;
            return !Object.values(rarities).some(stats => stats?.isAdminPetal);
        });
    }
    return cachedDroppablePetalTypes;
}
function getPetalRarities(petalType) {
    return Object.keys(exports.PETAL_CONFIG[petalType] || {});
}
