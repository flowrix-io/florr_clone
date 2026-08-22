"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MOB_CONFIG = exports.DUMMY_SIZE_SCALING = exports.PET_SIZE_SCALING = exports.SIZE_SCALING = exports.RARITY_LEVELS = exports.PETAL_RING_HIT_INTERVAL_MS = exports.PETAL_RING_ROTATION_SPEED = exports.PETAL_RING_HIT_SCALE = exports.PETAL_RING_PETAL_SCALE = exports.PETAL_RING_ORBIT_SCALE = exports.calculateMobDrops = exports.MOB_DROP_TABLES = exports.BASE_MOB_CONFIGS = void 0;
exports.getEnemySizeScale = getEnemySizeScale;
exports.getMobStats = getMobStats;
exports.getAllMobTypes = getAllMobTypes;
exports.getMobRarities = getMobRarities;
exports.getMobTypesBySection = getMobTypesBySection;
const mob_configs_1 = require("./mob_configs");
Object.defineProperty(exports, "BASE_MOB_CONFIGS", { enumerable: true, get: function () { return mob_configs_1.BASE_MOB_CONFIGS; } });
Object.defineProperty(exports, "PETAL_RING_ORBIT_SCALE", { enumerable: true, get: function () { return mob_configs_1.PETAL_RING_ORBIT_SCALE; } });
Object.defineProperty(exports, "PETAL_RING_PETAL_SCALE", { enumerable: true, get: function () { return mob_configs_1.PETAL_RING_PETAL_SCALE; } });
Object.defineProperty(exports, "PETAL_RING_HIT_SCALE", { enumerable: true, get: function () { return mob_configs_1.PETAL_RING_HIT_SCALE; } });
Object.defineProperty(exports, "PETAL_RING_ROTATION_SPEED", { enumerable: true, get: function () { return mob_configs_1.PETAL_RING_ROTATION_SPEED; } });
Object.defineProperty(exports, "PETAL_RING_HIT_INTERVAL_MS", { enumerable: true, get: function () { return mob_configs_1.PETAL_RING_HIT_INTERVAL_MS; } });
const mob_drops_1 = require("./mob_drops");
Object.defineProperty(exports, "MOB_DROP_TABLES", { enumerable: true, get: function () { return mob_drops_1.MOB_DROP_TABLES; } });
Object.defineProperty(exports, "calculateMobDrops", { enumerable: true, get: function () { return mob_drops_1.calculateMobDrops; } });
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
// Scaling multipliers for mob stats
const HEALTH_SCALING = {
    common: 1,
    uncommon: 3.75,
    rare: 13.5,
    epic: 54,
    legendary: 324,
    mythic: 3159,
    ultra: 126830,
    super: 2374000,
    unique: 10000000,
    apex: 1000000000
};
const DAMAGE_SCALING = {
    common: 1,
    uncommon: 3,
    rare: 9,
    epic: 27,
    legendary: 81,
    mythic: 243,
    ultra: 729,
    super: 2187,
    unique: 6561,
    apex: 1968300
};
exports.SIZE_SCALING = {
    common: 1.5,
    uncommon: 1.65,
    rare: 1.95,
    epic: 2.58,
    legendary: 4.5,
    mythic: 7.5,
    ultra: 10.5,
    super: 16.777216,
    unique: 26.8435456,
    apex: 42.9496730
};
/**
 * Build a size ramp that is 1x at common and `scaleAtUnique` at unique, linear
 * over the rarity ladder.
 *
 * Linear rather than geometric on purpose: SIZE_SCALING only grows 1.1x from
 * common to uncommon, so a geometric pull-down would make an uncommon smaller
 * than a common. Linear keeps effective size increasing at every step.
 * `apex` sits one index past unique, so it continues the same slope.
 */
function buildSizeRamp(scaleAtUnique) {
    const table = {};
    const uniqueIndex = exports.RARITY_LEVELS.indexOf('unique');
    for (let i = 0; i < exports.RARITY_LEVELS.length; i++) {
        table[exports.RARITY_LEVELS[i]] = 1 - (1 - scaleAtUnique) * (i / uniqueIndex);
    }
    return table;
}
/** What a unique pet's size is, as a fraction of a wild unique mob's. */
const PET_SIZE_SCALE_AT_UNIQUE = 1 / 3;
/**
 * Extra size multiplier applied to a mob spawned as a pet, on top of
 * SIZE_SCALING. Straight SIZE_SCALING makes a high-rarity pet dwarf the player
 * that owns it (a unique mob is 26.8x base), so the pet ramp is pulled down to
 * a third of the wild mob by unique, while a common pet stays exactly the size
 * of a common mob (1.5 -> 1.51 -> 1.63 -> ... -> 8.95 at unique).
 */
exports.PET_SIZE_SCALING = buildSizeRamp(PET_SIZE_SCALE_AT_UNIQUE);
/** What a unique target dummy's size is, as a fraction of a wild unique mob's. */
const DUMMY_SIZE_SCALE_AT_UNIQUE = 0.75;
/**
 * Size ramp for the target dummy. A common dummy matches a common mob exactly;
 * by unique it is pulled down to 75% of a wild unique, so the practice target
 * doesn't become an enormous wall at the top rarities.
 */
exports.DUMMY_SIZE_SCALING = buildSizeRamp(DUMMY_SIZE_SCALE_AT_UNIQUE);
/**
 * Size multiplier for a single live enemy. Every place that turns
 * `mobStats.size` into world pixels multiplies by this, so a mob's sprite, its
 * hitbox, its wall collisions and its melee reach all agree on one size.
 * `mobType` is required for that reason: a call site that can't name the type
 * would silently draw a dummy at a different size than it collides at.
 */
function getEnemySizeScale(isPet, tier, mobType) {
    if (isPet)
        return exports.PET_SIZE_SCALING[tier] ?? 1;
    if (mobType === 'target_dummy')
        return exports.DUMMY_SIZE_SCALING[tier] ?? 1;
    return 1;
}
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
    worker_ant: {
        common: 1,
        uncommon: 4,
        rare: 40,
        epic: 300,
        legendary: 2000,
        mythic: 42000,
        ultra: 220000,
        super: 1800000,
        unique: 8000000,
    },
    baby_ant: {
        common: 2,
        uncommon: 6,
        rare: 60,
        epic: 540,
        legendary: 2800,
        mythic: 64000,
        ultra: 300000,
        super: 2400000,
        unique: 13600000,
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
    },
    shiny_ladybug: {
        common: 1,
        uncommon: 5,
        rare: 20,
        epic: 180,
        legendary: 900,
        mythic: 28000,
        ultra: 120000,
        super: 960000,
        unique: 5440000
    },
    dandelion: {
        common: 1,
        uncommon: 1,
        rare: 2,
        epic: 22,
        legendary: 206,
        mythic: 3100,
        ultra: 19800,
        super: 2100000,
        unique: 6800000
    },
    soldier_fire_ant: {
        common: 1,
        uncommon: 1,
        rare: 2,
        epic: 22,
        legendary: 206,
        mythic: 3100,
        ultra: 19800,
        super: 2100000,
        unique: 6800000
    },
    dark_ladybug: {
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
    sandstorm: {
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
    cactus: {
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
    beetle: {
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
    hel_beetle: {
        common: 2,
        uncommon: 8,
        rare: 35,
        epic: 300,
        legendary: 1500,
        mythic: 40000,
        ultra: 200000,
        super: 1600000,
        unique: 8000000
    },
    jellyfish: {
        common: 2,
        uncommon: 8,
        rare: 35,
        epic: 300,
        legendary: 1500,
        mythic: 40000,
        ultra: 200000,
        super: 1600000,
        unique: 8000000
    },
    bubble: {
        common: 1,
        uncommon: 1,
        rare: 2,
        epic: 22,
        legendary: 206,
        mythic: 900,
        ultra: 18000,
        super: 1000000,
        unique: 4500000
    },
    starfish: {
        common: 2,
        uncommon: 2,
        rare: 8,
        epic: 30,
        legendary: 421,
        mythic: 1200,
        ultra: 25000,
        super: 1500000,
        unique: 7500000
    },
    sponge_1: {
        common: 1,
        uncommon: 1,
        rare: 2,
        epic: 22,
        legendary: 222,
        mythic: 722,
        ultra: 22220,
        super: 700000,
        unique: 2000000
    },
    sponge_2: {
        common: 1,
        uncommon: 1,
        rare: 2,
        epic: 22,
        legendary: 222,
        mythic: 722,
        ultra: 22220,
        super: 700000,
        unique: 2000000
    },
    hornet: {
        common: 2,
        uncommon: 8,
        rare: 35,
        epic: 300,
        legendary: 1500,
        mythic: 40000,
        ultra: 200000,
        super: 1600000,
        unique: 8000000
    },
    mantis: {
        common: 2,
        uncommon: 8,
        rare: 35,
        epic: 300,
        legendary: 1500,
        mythic: 40000,
        ultra: 200000,
        super: 1600000,
        unique: 8000000
    },
    leafbug: {
        common: 1,
        uncommon: 1,
        rare: 2,
        epic: 22,
        legendary: 206,
        mythic: 3100,
        ultra: 19800,
        super: 2100000,
        unique: 6800000
    },
    bush: {
        common: 1,
        uncommon: 1,
        rare: 2,
        epic: 22,
        legendary: 206,
        mythic: 3100,
        ultra: 19800,
        super: 2100000,
        unique: 6800000
    },
    target_dummy: {
        common: 100,
        uncommon: 100,
        rare: 100,
        epic: 100,
        legendary: 100,
        mythic: 100,
        ultra: 100,
        super: 100,
        unique: 100
    },
    fly: {
        common: 1,
        uncommon: 1,
        rare: 2,
        epic: 22,
        legendary: 206,
        mythic: 3100,
        ultra: 19800,
        super: 2100000,
        unique: 6800000
    },
    moth: {
        common: 1,
        uncommon: 1,
        rare: 2,
        epic: 22,
        legendary: 206,
        mythic: 3100,
        ultra: 19800,
        super: 2100000,
        unique: 6800000
    },
    roach: {
        common: 1,
        uncommon: 1,
        rare: 2,
        epic: 22,
        legendary: 206,
        mythic: 3100,
        ultra: 19800,
        super: 2100000,
        unique: 6800000
    },
    garbage: {
        common: 1,
        uncommon: 1,
        rare: 2,
        epic: 22,
        legendary: 206,
        mythic: 3100,
        ultra: 19800,
        super: 2100000,
        unique: 6800000
    },
    spider: {
        common: 1,
        uncommon: 1,
        rare: 2,
        epic: 22,
        legendary: 206,
        mythic: 3100,
        ultra: 19800,
        super: 2100000,
        unique: 6800000
    },
    javascript: {
        common: 1,
        uncommon: 2,
        rare: 5,
        epic: 35,
        legendary: 490,
        mythic: 8200,
        ultra: 200000,
        super: 1600000,
        unique: 8000000
    },
    glitch: {
        common: 1,
        uncommon: 3,
        rare: 10,
        epic: 70,
        legendary: 980,
        mythic: 14800,
        ultra: 220000,
        super: 1800000,
        unique: 10000000
    },
    glitch_flower: {
        common: 2,
        uncommon: 5,
        rare: 16,
        epic: 110,
        legendary: 1500,
        mythic: 22000,
        ultra: 330000,
        super: 2700000,
        unique: 15000000
    },
    dust: {
        common: 1,
        uncommon: 1,
        rare: 2,
        epic: 22,
        legendary: 125,
        mythic: 1800,
        ultra: 12500,
        super: 1250000,
        unique: 5000000
    },
    cube: {
        common: 1,
        uncommon: 1,
        rare: 10,
        epic: 70,
        legendary: 980,
        mythic: 8100,
        ultra: 220000,
        super: 1800000,
        unique: 10000000
    },
    centipede: {
        common: 2,
        uncommon: 6,
        rare: 40,
        epic: 320,
        legendary: 1600,
        mythic: 36000,
        ultra: 180000,
        super: 1400000,
        unique: 7800000
    },
    centipede_body: {
        common: 1,
        uncommon: 2,
        rare: 10,
        epic: 80,
        legendary: 400,
        mythic: 9000,
        ultra: 45000,
        super: 350000,
        unique: 1950000
    },
    desert_centipede: {
        common: 2,
        uncommon: 6,
        rare: 40,
        epic: 320,
        legendary: 1600,
        mythic: 36000,
        ultra: 180000,
        super: 1400000,
        unique: 7800000
    },
    desert_centipede_body: {
        common: 1,
        uncommon: 2,
        rare: 10,
        epic: 80,
        legendary: 400,
        mythic: 9000,
        ultra: 45000,
        super: 350000,
        unique: 1950000
    },
    evil_centipede: {
        common: 3,
        uncommon: 9,
        rare: 60,
        epic: 480,
        legendary: 2400,
        mythic: 54000,
        ultra: 270000,
        super: 2100000,
        unique: 11700000
    },
    evil_centipede_body: {
        common: 1,
        uncommon: 3,
        rare: 15,
        epic: 120,
        legendary: 600,
        mythic: 13500,
        ultra: 67500,
        super: 525000,
        unique: 2900000
    },
    queen_ant: {
        common: 15,
        uncommon: 60,
        rare: 360,
        epic: 2400,
        legendary: 13500,
        mythic: 270000,
        ultra: 1350000,
        super: 10500000,
        unique: 54000000
    },
    digger: {
        common: 20,
        uncommon: 80,
        rare: 480,
        epic: 3200,
        legendary: 18000,
        mythic: 360000,
        ultra: 1800000,
        super: 14000000,
        unique: 72000000
    },
    ant_hole: {
        common: 5,
        uncommon: 20,
        rare: 120,
        epic: 800,
        legendary: 4500,
        mythic: 90000,
        ultra: 450000,
        super: 3500000,
        unique: 18000000
    },
    fire_ant_hole: {
        common: 5,
        uncommon: 20,
        rare: 120,
        epic: 800,
        legendary: 4500,
        mythic: 90000,
        ultra: 450000,
        super: 3500000,
        unique: 18000000
    }
};
// Base mob configurations - only common rarity stats
// Rarity-specific overrides for special cases
const RARITY_OVERRIDES = {
    // From rare up, bees defend themselves: neutral doesn't scan for targets but
    // aggros its attacker when hit (trackDamage sets targetPlayerId, which the
    // chase branch treats as provoked). Common/uncommon stay fully passive.
    bee: {
        rare: { ai_type: 'neutral' },
        epic: { ai_type: 'neutral' },
        legendary: { ai_type: 'neutral' },
        mythic: { ai_type: 'neutral' },
        ultra: { ai_type: 'neutral' },
        super: { ai_type: 'neutral' },
        unique: { ai_type: 'neutral' },
        apex: { ai_type: 'neutral' },
    },
    soldier_ant: {
        uncommon: {
            range: 500
        },
        rare: {
            range: 600
        },
        epic: {
            range: 750
        },
        legendary: {
            range: 900
        },
        mythic: {
            range: 1100
        },
        ultra: {
            range: 1300,
        },
        super: {
            range: 1500,
        },
        unique: {
            range: 1700,
        }
    },
    worker_ant: {
        uncommon: {
            range: 500
        },
        rare: {
            range: 600
        },
        epic: {
            range: 750
        },
        legendary: {
            range: 900
        },
        mythic: {
            range: 1100
        },
        ultra: {
            range: 1300,
        },
        super: {
            range: 1500,
        },
        unique: {
            range: 1700,
        }
    },
    ladybug: {
        rare: {
            range: 350,
            ai_type: 'neutral',
        },
        epic: {
            range: 500,
            ai_type: 'neutral',
        },
        legendary: {
            range: 700,
            ai_type: 'neutral',
        },
        mythic: {
            range: 900,
            ai_type: 'neutral',
        },
        ultra: {
            range: 1100,
            ai_type: 'neutral',
        },
        super: {
            range: 1300,
            ai_type: 'neutral',
        },
        unique: {
            range: 1500,
            ai_type: 'neutral',
        }
    },
    soldier_fire_ant: {
        uncommon: {
            range: 700
        },
        rare: {
            range: 900
        },
        epic: {
            range: 1100
        },
        legendary: {
            range: 1300
        },
        mythic: {
            range: 1500
        },
        ultra: {
            range: 1700
        },
        super: {
            range: 1900
        },
        unique: {
            range: 2100
        }
    },
    shiny_ladybug: {
        uncommon: {
            range: 500
        },
        rare: {
            range: 600
        },
        epic: {
            range: 750
        },
        legendary: {
            range: 900
        },
        mythic: {
            range: 1100
        },
        ultra: {
            range: 1300,
        },
        super: {
            range: 1500,
        },
        unique: {
            range: 1700,
        }
    },
    hel_beetle: {
        uncommon: {
            range: 500
        },
        rare: {
            range: 600
        },
        epic: {
            range: 750
        },
        legendary: {
            range: 900
        },
        mythic: {
            range: 1100
        },
        ultra: {
            range: 1300,
        },
        super: {
            range: 1500,
        },
        unique: {
            range: 1700,
        }
    },
    beetle: {
        uncommon: {
            range: 500
        },
        rare: {
            range: 600
        },
        epic: {
            range: 750
        },
        legendary: {
            range: 900
        },
        mythic: {
            range: 1100
        },
        ultra: {
            range: 1300,
        },
        super: {
            range: 1500,
        },
        unique: {
            range: 1700,
        }
    },
    jellyfish: {
        uncommon: {
            range: 700
        },
        rare: {
            range: 800
        },
        epic: {
            range: 950
        },
        legendary: {
            range: 1100
        },
        mythic: {
            range: 1300
        },
        ultra: {
            range: 1500,
        },
        super: {
            range: 1700,
        },
        unique: {
            range: 1900,
        }
    },
    starfish: {
        uncommon: {
            range: 500
        },
        rare: {
            range: 600
        },
        epic: {
            range: 750
        },
        legendary: {
            range: 900
        },
        mythic: {
            range: 1100
        },
        ultra: {
            range: 1300,
        },
        super: {
            range: 1500,
        },
        unique: {
            range: 1700,
        }
    },
    hornet: {
        uncommon: {
            range: 500
        },
        rare: {
            range: 600
        },
        epic: {
            range: 750
        },
        legendary: {
            range: 900
        },
        mythic: {
            range: 1100
        },
        ultra: {
            range: 1300,
        },
        super: {
            range: 1500,
        },
        unique: {
            range: 1700,
        }
    },
    mantis: {
        uncommon: {
            range: 500
        },
        rare: {
            range: 600
        },
        epic: {
            range: 750
        },
        legendary: {
            range: 900
        },
        mythic: {
            range: 1100
        },
        ultra: {
            range: 1300,
        },
        super: {
            range: 1500,
        },
        unique: {
            range: 1700,
        }
    },
    glitch: {
        uncommon: {
            range: 500
        },
        rare: {
            range: 600
        },
        epic: {
            range: 750
        },
        legendary: {
            range: 900
        },
        mythic: {
            range: 1100
        },
        ultra: {
            range: 1300,
        },
        super: {
            range: 1500,
        },
        unique: {
            range: 1700,
        }
    },
    // Sees a little further than a plain glitch at every tier — it has to close
    // the distance to use its ring, so it commits to the chase earlier.
    glitch_flower: {
        uncommon: {
            range: 850
        },
        rare: {
            range: 1000
        },
        epic: {
            range: 1150
        },
        legendary: {
            range: 1300
        },
        mythic: {
            range: 1500
        },
        ultra: {
            range: 1700,
        },
        super: {
            range: 1900,
        },
        unique: {
            range: 2100,
        }
    },
    spider: {
        uncommon: {
            range: 800
        },
        rare: {
            range: 1000
        },
        epic: {
            range: 1200
        },
        legendary: {
            range: 1400
        },
        mythic: {
            range: 1600
        },
        ultra: {
            range: 1800,
        },
        super: {
            range: 2000,
        },
        unique: {
            range: 2200,
        }
    },
    // Above rare, centipedes become neutral: they retaliate when any segment takes damage
    centipede: {
        epic: { ai_type: 'neutral' },
        legendary: { ai_type: 'neutral' },
        mythic: { ai_type: 'neutral' },
        ultra: { ai_type: 'neutral' },
        super: { ai_type: 'neutral' },
        unique: { ai_type: 'neutral' },
        apex: { ai_type: 'neutral' }
    },
    centipede_body: {
        epic: { ai_type: 'neutral' },
        legendary: { ai_type: 'neutral' },
        mythic: { ai_type: 'neutral' },
        ultra: { ai_type: 'neutral' },
        super: { ai_type: 'neutral' },
        unique: { ai_type: 'neutral' },
        apex: { ai_type: 'neutral' }
    },
    desert_centipede: {
        epic: { ai_type: 'neutral' },
        legendary: { ai_type: 'neutral' },
        mythic: { ai_type: 'neutral' },
        ultra: { ai_type: 'neutral' },
        super: { ai_type: 'neutral' },
        unique: { ai_type: 'neutral' },
        apex: { ai_type: 'neutral' }
    },
    desert_centipede_body: {
        epic: { ai_type: 'neutral' },
        legendary: { ai_type: 'neutral' },
        mythic: { ai_type: 'neutral' },
        ultra: { ai_type: 'neutral' },
        super: { ai_type: 'neutral' },
        unique: { ai_type: 'neutral' },
        apex: { ai_type: 'neutral' }
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
// Function to generate mob stats for a specific rarity
function generateMobStats(baseConfig, rarity, mobType) {
    // Calculate scaled stats
    const damage = baseConfig.damage * DAMAGE_SCALING[rarity];
    const health = baseConfig.health * HEALTH_SCALING[rarity];
    // Calculate size scaling using the size scaling table
    // Size already includes rarity scaling, so mass will automatically account for rarity
    const size = baseConfig.size * exports.SIZE_SCALING[rarity];
    // Calculate mass based on size (mass scales with area, size^2)
    // Larger mobs and higher rarity mobs (which have larger size) will have more mass
    const mass = size * size; // Mass proportional to area (size^2)
    // Get XP from the specific mob XP table.
    const mobXpTable = MOB_XP_TABLES[mobType];
    let xp = mobXpTable?.[rarity] || 1;
    // Apex XP was never enumerated per-mob in MOB_XP_TABLES (they stop at unique),
    // which left apex mobs awarding the fallback of 1 XP. Derive it from the unique
    // tier using the same 3x step the apex stat-scaling tables use (HEALTH_SCALING
    // and DAMAGE_SCALING both go unique*3 -> apex).
    if (rarity === 'apex' && mobXpTable && mobXpTable['apex'] === undefined && mobXpTable['unique'] !== undefined) {
        xp = mobXpTable['unique'] * 3;
    }
    // Get rarity-specific overrides
    const overrides = RARITY_OVERRIDES[mobType]?.[rarity] || {};
    // Generate name with prefix
    const prefix = RARITY_PREFIXES[rarity];
    const name = overrides.name || (prefix ? `${prefix} ${baseConfig.name.replace('Common ', '')}` : baseConfig.name);
    // `min_rarity` is enforced by emptying the section list below that rarity.
    // Every spawner (density loop, zones, maze, biome tables) already filters on
    // `getMobStats(type, tier).section`, so there is exactly one thing to get
    // right here instead of a check at each of those call sites.
    let section = overrides.section ?? baseConfig.section ?? [];
    const minRarity = baseConfig.min_rarity;
    if (minRarity && exports.RARITY_LEVELS.indexOf(rarity) < exports.RARITY_LEVELS.indexOf(minRarity)) {
        section = [];
    }
    return {
        name,
        damage,
        health,
        size,
        mass,
        speed: overrides.speed ?? baseConfig.speed,
        cooldown: overrides.cooldown ?? baseConfig.cooldown,
        description: overrides.description ?? baseConfig.description,
        color: overrides.color ?? RARITY_COLORS[rarity],
        image: overrides.image ?? baseConfig.image,
        ai_type: overrides.ai_type ?? baseConfig.ai_type,
        range: overrides.range ?? baseConfig.range,
        xp,
        section,
        visual_scale: overrides.visual_scale ?? baseConfig.visual_scale ?? 1.0,
        reversed: overrides.reversed ?? baseConfig.reversed ?? false,
        hideRotation: overrides.hideRotation ?? baseConfig.hideRotation ?? false,
        noEggDrop: overrides.noEggDrop ?? baseConfig.noEggDrop ?? false,
        spawn_weight: overrides.spawn_weight ?? baseConfig.spawn_weight ?? 1,
        emissive: overrides.emissive ?? baseConfig.emissive,
        light_radius: overrides.light_radius ?? baseConfig.light_radius,
        light_color: overrides.light_color ?? baseConfig.light_color,
        projectile: overrides.projectile ?? baseConfig.projectile,
        spawn_waves: overrides.spawn_waves ?? baseConfig.spawn_waves,
        initial_spawns: overrides.initial_spawns ?? baseConfig.initial_spawns,
        no_mob_collision: overrides.no_mob_collision ?? baseConfig.no_mob_collision,
        petal_ring: overrides.petal_ring ?? baseConfig.petal_ring,
        periodic_spawn: overrides.periodic_spawn ?? baseConfig.periodic_spawn,
        // Poison is damage, so it rides the same DAMAGE_SCALING curve the mob's
        // body damage does — otherwise an apex evil centipede's bite would tick
        // for the same 5 dps as a common one and be pure decoration.
        poison: overrides.poison ?? (baseConfig.poison !== undefined
            ? baseConfig.poison * DAMAGE_SCALING[rarity]
            : undefined),
        poisonDuration: overrides.poisonDuration ?? baseConfig.poisonDuration
    };
}
// Generate the full mob configuration
exports.MOB_CONFIG = {};
// Initialize the mob configuration
for (const mobType in mob_configs_1.BASE_MOB_CONFIGS) {
    exports.MOB_CONFIG[mobType] = {};
    for (const rarity of exports.RARITY_LEVELS) {
        exports.MOB_CONFIG[mobType][rarity] = generateMobStats(mob_configs_1.BASE_MOB_CONFIGS[mobType], rarity, mobType);
    }
}
// Server-only memory trim: drop the embedded SVG image strings (~100KB of source,
// ~200KB resident as UTF-16 in V8) — the server never renders mobs and only the
// client's bundle consults `image`. petImage stays because it's emitted to clients
// alongside spawned pets.
if (typeof window === 'undefined' && typeof process !== 'undefined') {
    for (const mobType in mob_configs_1.BASE_MOB_CONFIGS) {
        mob_configs_1.BASE_MOB_CONFIGS[mobType].image = '';
    }
    for (const mobType in exports.MOB_CONFIG) {
        const tiers = exports.MOB_CONFIG[mobType];
        for (const rarity in tiers) {
            tiers[rarity].image = '';
        }
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
/**
 * Get all mob types that belong to a specific section (0-8)
 * Used for section-based texture loading optimization
 */
function getMobTypesBySection(section) {
    const result = [];
    for (const mobType of Object.keys(exports.MOB_CONFIG)) {
        // Read the declared section off the base config rather than a rarity
        // row: a `min_rarity` mob has an EMPTY section list on every rarity
        // below its floor (that is how the floor is enforced), so checking the
        // common row alone would leave evil centipedes/queen ants/diggers out
        // of their biome's texture preload.
        const declared = mob_configs_1.BASE_MOB_CONFIGS[mobType]?.section;
        if (declared && declared.includes(section)) {
            result.push(mobType);
        }
    }
    return result;
}
