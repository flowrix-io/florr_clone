export interface MobStats {
    name: string;
    damage: number;
    health: number;
    size: number;
    mass: number; // Mass of the mob (affects knockback resistance, calculated from size)
    speed: number; // Movement speed
    cooldown: number; // Attack cooldown time in milliseconds
    description: string;
    color: string;
    image: string; // 32x32 SVG image
    ai_type: 'passive' | 'neutral' | 'hostile' | 'sandstorm'; // AI behavior type
    range: number; // Detection/attack range
    xp: number; // Experience points awarded when defeated
    section: number[]; // Section numbers (0-8) where this mob spawns. Empty array means the mob does not spawn naturally. See SECTION_CONFIGS in constants.ts
    visual_scale?: number; // Visual scale multiplier (affects rendering only, not hitbox)
    reversed?: boolean; // Whether the mob image should be flipped horizontally
    hideRotation?: boolean; // Whether to hide the mob's rotation visually (mob always faces default direction)
    noEggDrop?: boolean; // Whether this mob should not drop eggs
    petImage?: string; // Optional image to use when this mob is spawned as a pet (32x32 SVG image)
    spawn_weight: number; // Spawn weight relative to other mobs (1 = normal, <1 = less common, >1 = more common)
    emissive?: boolean; // Whether this mob emits light
    light_radius?: number; // Radius of the emissive light glow (in pixels, default: mob size * 2)
    light_color?: string; // Color of the emissive light (defaults to mob color)
    projectile?: {
        count: number; // Number of projectiles to shoot
        distance: number; // Maximum distance projectiles travel
        petalType: string; // Type of petal to use as projectile (e.g., 'basic', 'stinger', 'rose')
        petalRarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic' | 'ultra' | 'super' | 'unique' | 'apex'; // Rarity of the petal projectile
        speed?: number; // Projectile speed (default: 200 pixels per second)
        spreadAngle?: number; // Spread angle in radians for multiple projectiles (default: 0.2)
    };
    // Mobs that spawn other mobs in waves as they take damage (like ant holes).
    // Each entry is a list of mob types spawned when that wave is crossed. The
    // first wave fires at full health; the last wave fires at death.
    spawn_waves?: string[][];
    // Mobs pre-spawned around this mob when it is itself spawned.
    initial_spawns?: string[];
    // If true, this mob does not participate in mob-mob collision resolution.
    no_mob_collision?: boolean;
}

export interface MobConfig {
    [mobType: string]: {
        [rarity: string]: MobStats;
    };
}

import { BaseMobConfig, BASE_MOB_CONFIGS } from './mob_configs';
import { DropItem, MobDropTable, MOB_DROP_TABLES, calculateMobDrops } from './mob_drops';
export { BaseMobConfig, BASE_MOB_CONFIGS, DropItem, MobDropTable, MOB_DROP_TABLES, calculateMobDrops };


// Rarity levels in order from lowest to highest
export const RARITY_LEVELS = [
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
] as const;

export type Rarity = typeof RARITY_LEVELS[number];

// Base mob configurations - only common rarity stats
// Special rarity overrides for specific mobs
interface RarityOverride {
    name?: string;
    description?: string;
    color?: string;
    image?: string;
    damage?: number;
    health?: number;
    size?: number;
    speed?: number;
    cooldown?: number;
    ai_type?: 'passive' | 'neutral' | 'hostile' | 'sandstorm';
    range?: number;
    section?: number[]; // Optional: section numbers (0-8) where this mob spawns. Empty array means the mob does not spawn naturally.
    visual_scale?: number; // Optional: visual scale multiplier (affects rendering only, not hitbox)
    reversed?: boolean; // Optional: whether the mob image should be flipped horizontally
    hideRotation?: boolean; // Optional: whether to hide the mob's rotation visually
    noEggDrop?: boolean; // Optional: whether this mob should not drop eggs
    petImage?: string; // Optional image to use when this mob is spawned as a pet (32x32 SVG image)
    spawn_weight?: number; // Spawn weight (1 = normal, <1 = less common, >1 = more common). Default is 1
    emissive?: boolean; // Whether this mob emits light
    light_radius?: number; // Radius of the emissive light glow (in pixels)
    light_color?: string; // Color of the emissive light
    projectile?: {
        count: number;
        distance: number;
        petalType: string;
        petalRarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary' | 'mythic' | 'ultra' | 'super' | 'unique' | 'apex';
        speed?: number;
        spreadAngle?: number;
    };
    spawn_waves?: string[][];
    initial_spawns?: string[];
    no_mob_collision?: boolean;
}

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
    apex: 30000000
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
    apex: 19683
};

export const SIZE_SCALING: { [key: string]: number } = {
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

// Separate XP tables for each mob type (maintaining original values)
const MOB_XP_TABLES: { [mobType: string]: { [rarity: string]: number } } = {
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
const RARITY_OVERRIDES: { [mobType: string]: { [rarity: string]: RarityOverride } } = {
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
const RARITY_COLORS: { [key in Rarity]: string } = {
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
const RARITY_PREFIXES: { [key in Rarity]: string } = {
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
function generateMobStats(baseConfig: BaseMobConfig, rarity: Rarity, mobType: string): MobStats {
    // Calculate scaled stats
    const damage = baseConfig.damage * DAMAGE_SCALING[rarity];
    const health = baseConfig.health * HEALTH_SCALING[rarity];
    
    // Calculate size scaling using the size scaling table
    // Size already includes rarity scaling, so mass will automatically account for rarity
    const size = baseConfig.size * SIZE_SCALING[rarity];
    
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
        section: overrides.section ?? baseConfig.section ?? [],
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
        no_mob_collision: overrides.no_mob_collision ?? baseConfig.no_mob_collision
    };
}

// Generate the full mob configuration
export const MOB_CONFIG: MobConfig = {};

// Initialize the mob configuration
for (const mobType in BASE_MOB_CONFIGS) {
    MOB_CONFIG[mobType] = {};
    for (const rarity of RARITY_LEVELS) {
        MOB_CONFIG[mobType][rarity] = generateMobStats(BASE_MOB_CONFIGS[mobType], rarity, mobType);
    }
}

// Server-only memory trim: drop the embedded SVG image strings (~100KB of source,
// ~200KB resident as UTF-16 in V8) — the server never renders mobs and only the
// client's bundle consults `image`. petImage stays because it's emitted to clients
// alongside spawned pets.
if (typeof window === 'undefined' && typeof process !== 'undefined') {
    for (const mobType in BASE_MOB_CONFIGS) {
        BASE_MOB_CONFIGS[mobType].image = '';
    }
    for (const mobType in MOB_CONFIG) {
        const tiers = MOB_CONFIG[mobType];
        for (const rarity in tiers) {
            tiers[rarity].image = '';
        }
    }
}

export function getMobStats(mobType: string, rarity: string): MobStats | null {
    return MOB_CONFIG[mobType]?.[rarity] || null;
}

export function getAllMobTypes(): string[] {
    return Object.keys(MOB_CONFIG);
}

export function getMobRarities(mobType: string): string[] {
    return Object.keys(MOB_CONFIG[mobType] || {});
}

/**
 * Get all mob types that belong to a specific section (0-8)
 * Used for section-based texture loading optimization
 */
export function getMobTypesBySection(section: number): string[] {
    const result: string[] = [];
    for (const mobType of Object.keys(MOB_CONFIG)) {
        // Check the common rarity to get the section (all rarities share the same section)
        const stats = MOB_CONFIG[mobType]?.common;
        if (stats && stats.section.includes(section)) {
            result.push(mobType);
        }
    }
    return result;
}
