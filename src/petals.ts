import { test_petal_action } from "./petal_action/test.action";
import { blood_leaf_action } from "./petal_action/blood_leaf.action";
import { BASE_MOB_CONFIGS } from "./mobs";
import { EquipmentFlags } from "./player";
export interface PlayerModifiers {
    damage?: number; // Multiplier for player damage (e.g., 1.2 = +20% damage)
    maxHealth?: number; // Multiplier for player max health (e.g., 1.15 = +15% health)
    speed?: number; // Multiplier for player movement speed (e.g., 1.1 = +10% speed)
    range?: number; // Multiplier for petal orbit range (e.g., 1.2 = +20% range)
    rotationSpeed?: number; // Multiplier for global petal rotation speed (e.g., 1.5 = +50% rotation speed)
}

export interface PetalStats {
    name: string;
    damage: number;
    health: number;
    size: number;
    speed?: number; // Rotation speed multiplier (default 1.0)
    cooldown: number; // Cooldown time in milliseconds
    knockback?: number; // Knockback force applied to enemies (default 1)
    poison?: number; // Poison damage per millisecond applied to units (optional)
    poisonDuration?: number; // Duration in milliseconds that poison effect lasts (optional)
    description: string;
    color: string;
    image?: string; // 32x32 SVG image (optional)
    count: number; // Number of petals to spawn per equipped item (default 1)
    actions?: string; // Action sequence string like "heal 20; break;" (optional)
    passiveHeal?: number; // Passive healing per second (optional)
    isAdminPetal?: boolean; // Whether the petal is an admin petal (default false)
    range?: number; // Multiplier for how much the petal extends from player (default 1.0)
    projectile?: {
        count: number; // Number of projectiles to shoot
        distance: number; // Maximum distance projectiles travel
        speed?: number; // Projectile speed (default: 200 pixels per second)
        spreadAngle?: number; // Spread angle in radians for multiple projectiles (default: 0.2)
    };
    playerModifiers?: PlayerModifiers; // Player stat modifiers when petal is equipped (optional)
    petMobType?: string; // Optional mob type to spawn as a pet when this petal is equipped (e.g., 'bee', 'ladybug')
    petMobRarity?: string; // Optional rarity for the pet mob (defaults to petal's rarity if not specified)
    // Physics properties (optional, defaults to base values if not specified)
    attractionForce?: number; // Attraction force towards mobs (pixels per second^2, default: 500)
    springForce?: number; // Spring force back to orbit position (pixels per second^2, default: 200)
    damping?: number; // Velocity damping per frame (0-1, default: 0.92)
    maxAttractionDistance?: number; // Maximum distance to attract to mobs (pixels, default: 2000)
    minAttractionDistance?: number; // Minimum distance to avoid division by zero (pixels, default: 1)
    spawnSmoothTime?: number; // Time in ms to smoothly ramp up forces after spawn (default: 300)
    // Visual properties
    fixedDirection?: number; // Fixed angle (radians) the petal visual faces in orbit, instead of spinning around its own center
    visualOffsetX?: number; // X shift for the petal visual relative to its center (pixels, default: 0)
    visualOffsetY?: number; // Y shift for the petal visual relative to its center (pixels, default: 0)
    damageCooldown?: number; // Time in ms between damage hits (petal stays active but can't deal damage during cooldown)
    // Appearance flags applied to the player when this petal is equipped
    faceFlags?: number; // Bitmask of FaceFlags to apply (e.g., FaceFlags.SquareEyes)
    equipFlags?: number; // Bitmask of EquipmentFlags to apply (e.g., EquipmentFlags.ThirdEye)
    noPhysics?: boolean; // When true, petal snaps to orbit position without spring/damping physics (no lag behind player)
    clumped?: boolean; // When true, all instances of this petal share a single orbit slot instead of being spread evenly
    // Emissive light properties
    emissive?: boolean; // Whether this petal emits light
    lightRadius?: number; // Radius of the emissive light glow (in pixels, default: petal size * 3)
    lightColor?: string; // Color of the emissive light (defaults to petal color)
}

export interface PetalConfig {
    [petalType: string]: {
        [rarity: string]: PetalStats;
    };
}

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

// Canonical UI rarity colors — single source of truth for all panels/UI
export const ITEM_RARITY_COLORS: Record<string, string> = {
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

// Petal action types
export interface PetalAction {
    type: 'heal' | 'break' | 'damage_boost' | 'speed_boost' | 'shield' | 'explode' | 'delay' | 'restart' | 'wait_until_collision' | 'lightning' | 
          'if' | 'else' | 'endif' | 'loop' | 'endloop' | 'goto' | 'label' |
          'set_memory' | 'get_memory' | 'add_memory' | 'multiply_memory' |
          'set_petal_damage' | 'set_petal_health' | 'set_petal_size' | 'add_petal_damage' | 'add_petal_health' | 'add_petal_size' |
          'set_player_damage' | 'set_player_max_health' | 'set_player_speed' | 'add_player_damage' | 'add_player_max_health' | 'add_player_speed' |
          'compare' | 'compare_gt' | 'compare_lt' | 'compare_gte' | 'compare_lte' | 'compare_eq' | 'compare_neq' |
          'split_player' | 'switch_player';
    value?: number; // Optional numeric parameter for the action
    duration?: number; // Optional duration for temporary effects (in milliseconds)
    stringValue?: string; // Optional string parameter (for labels, memory keys, etc.)
    condition?: string; // For if statements: condition expression
    comparisonType?: 'gt' | 'lt' | 'gte' | 'lte' | 'eq' | 'neq'; // For compare actions
}

// Action trigger conditions
export type ActionTrigger = 'on_hit' | 'on_break' | 'on_equip' | 'on_timer' | 'on_low_health';

// Base petal configurations - only common rarity stats
interface BasePetalConfig {
    name: string;
    damage: number;
    health: number;
    size: number;
    cooldown: number;
    description: string;
    color: string;
    image?: string;
    count: number;
    speed?: number;
    knockback?: number;
    poison?: number; // Poison damage per millisecond applied to units (optional)
    poisonDuration?: number; // Duration in milliseconds that poison effect lasts (optional)
    actions?: string; // Action sequence string like "heal 20; break;"
    passiveHeal?: number; // Passive healing per second (optional)
    isAdminPetal?: boolean; // Whether the petal is an admin petal (default false)
    range?: number; // Multiplier for how much the petal extends from player (default 1.0)
    projectile?: {
        count: number; // Number of projectiles to shoot
        distance: number; // Maximum distance projectiles travel
        speed?: number; // Projectile speed (default: 200 pixels per second)
        spreadAngle?: number; // Spread angle in radians for multiple projectiles (default: 0.2)
    };
    playerModifiers?: PlayerModifiers; // Player stat modifiers when petal is equipped (optional)
    petMobType?: string; // Optional mob type to spawn as a pet when this petal is equipped (e.g., 'bee', 'ladybug')
    petMobRarity?: string; // Optional rarity for the pet mob (defaults to petal's rarity if not specified)
    // Physics properties (optional, defaults to base values if not specified)
    attractionForce?: number; // Attraction force towards mobs (pixels per second^2, default: 500)
    springForce?: number; // Spring force back to orbit position (pixels per second^2, default: 200)
    damping?: number; // Velocity damping per frame (0-1, default: 0.92)
    maxAttractionDistance?: number; // Maximum distance to attract to mobs (pixels, default: 2000)
    minAttractionDistance?: number; // Minimum distance to avoid division by zero (pixels, default: 1)
    spawnSmoothTime?: number; // Time in ms to smoothly ramp up forces after spawn (default: 300)
    // Visual properties
    fixedDirection?: number; // Fixed angle (radians) the petal visual faces in orbit, instead of spinning around its own center
    visualOffsetX?: number; // X shift for the petal visual relative to its center (pixels, default: 0)
    visualOffsetY?: number; // Y shift for the petal visual relative to its center (pixels, default: 0)
    damageCooldown?: number; // Time in ms between damage hits (petal stays active but can't deal damage during cooldown)
    // Appearance flags applied to the player when this petal is equipped
    faceFlags?: number; // Bitmask of FaceFlags to apply (e.g., FaceFlags.SquareEyes)
    equipFlags?: number; // Bitmask of EquipmentFlags to apply (e.g., EquipmentFlags.ThirdEye)
    noPhysics?: boolean; // When true, petal snaps to orbit position without spring/damping physics (no lag behind player)
    clumped?: boolean; // When true, all instances of this petal share a single orbit slot instead of being spread evenly
    // Emissive light properties
    emissive?: boolean; // Whether this petal emits light
    lightRadius?: number; // Radius of the emissive light glow (in pixels, default: petal size * 3)
    lightColor?: string; // Color of the emissive light (defaults to petal color)
}

// Special rarity overrides for specific petals
interface RarityOverride {
    knockback?: number;
    count?: number;
    image?: string;
    description?: string;
    cooldown?: number;
    damage?: number;
    health?: number;
    poison?: number; // Poison damage per millisecond applied to units (optional)
    poisonDuration?: number; // Duration in milliseconds that poison effect lasts (optional)
    actions?: string; // Action sequence string like "heal 20; break;"
    range?: number; // Multiplier for how much the petal extends from player (optional)
    playerModifiers?: PlayerModifiers; // Player stat modifiers when petal is equipped (optional)
    petMobType?: string; // Optional mob type to spawn as a pet when this petal is equipped (e.g., 'bee', 'ladybug')
    petMobRarity?: string; // Optional rarity for the pet mob (defaults to petal's rarity if not specified)
    // Physics properties (optional, defaults to base values if not specified)
    attractionForce?: number; // Attraction force towards mobs (pixels per second^2, default: 500)
    springForce?: number; // Spring force back to orbit position (pixels per second^2, default: 200)
    damping?: number; // Velocity damping per frame (0-1, default: 0.92)
    maxAttractionDistance?: number; // Maximum distance to attract to mobs (pixels, default: 2000)
    minAttractionDistance?: number; // Minimum distance to avoid division by zero (pixels, default: 1)
    spawnSmoothTime?: number; // Time in ms to smoothly ramp up forces after spawn (default: 300)
    // Visual properties
    fixedDirection?: number;
    visualOffsetX?: number;
    visualOffsetY?: number;
    damageCooldown?: number;
    clumped?: boolean;
    // Emissive light properties
    emissive?: boolean;
    lightRadius?: number;
    lightColor?: string;
}

// Rarity-specific overrides for special cases
const RARITY_OVERRIDES: { [petalType: string]: { [rarity: string]: RarityOverride } } = {
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
    },
};

// Base petal configurations - only common rarity stats
const BASE_PETAL_CONFIGS: { [petalType: string]: BasePetalConfig } = {
    basic: {
            name: "Basic Petal",
            damage: 10,
            health: 10,
            size: 2.0,
        cooldown: 1200,
            description: "A simple petal that provides basic protection",
            color: "#90EE90",
            count: 1,
            knockback: 5,
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
            description: "It heals, but not very good at combat",
            color: "#FF69B4",
        count: 1,
            passiveHeal: 1, // Base heal: 1 HP/sec at common
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
            description: "A sharp petal that prioritizes offense",
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
            description: "Weak, but recharges quickly",
            color: "#90EE90",
            count: 1,
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="14" fill="white" stroke-width="4" stroke="#d9d9d9"/>
</svg>`
    },
    rock: {
            name: "Rock Petal",
            damage: 15,
            health: 45,
            size: 1.0,
            cooldown: 400,
            description: "Very strong, but recharges slowly",
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
            health: 3,
            size: 0.8,
            cooldown: 800,
            description: "Don't get this in your eyes",
            color: "#8B0000",
            count: 4,
            clumped: true,
            image: `<svg width="20" height="20" viewBox="-10 -10 20 20" xmlns="http://www.w3.org/2000/svg">
  <path
    d="M 7 0 L 3.5 6.062 L -3.5 6.062 L -7 0 L -3.5 -6.062 L 3.5 -6.062 Z"
    fill="#e0c85c"
    stroke="#b5a24b"
    stroke-width="3"
    stroke-linecap="round"
    stroke-linejoin="round"
  />
</svg>`
    },
    yggdrasil: {
        name: "Yggdrasil Petal",
        damage: 1,
        health: 1,
        size: 1.0,
        cooldown: 2048000,
        description: "It can revive flowers",
        color: "#FFD700",
        count: 1,
        image: `<svg width="32" height="32" viewBox="-300 -300 600 600" xmlns="http://www.w3.org/2000/svg">
  <path fill="#886d35" d="M -273.54 -218.49 Q -284.88 -187.49 -267.08 -151.41 Q -262.72 -142.57 -254.82 -136.69 Q -246.93 -130.80 -237.22 -129.15 Q -222.87 -126.71 -208.62 -122.97 Q -212.49 -112.19 -216.13 -100.75 Q -218.33 -96.85 -219.63 -92.56 Q -220.93 -88.27 -221.28 -83.80 Q -229.91 -54.12 -240.77 -7.55 Q -244.62 8.97 -235.66 23.37 Q -226.71 37.78 -210.19 41.64 L -199.07 44.23 L -203.90 73.81 Q -203.91 73.87 -203.91 73.93 Q -203.92 73.98 -203.93 74.04 Q -205.20 82.09 -203.29 90.01 Q -201.38 97.93 -196.58 104.52 Q -191.79 111.10 -184.84 115.35 Q -177.88 119.60 -169.84 120.87 L -168.30 121.11 L -169.08 125.06 Q -169.09 125.10 -169.10 125.14 Q -169.11 125.18 -169.11 125.22 Q -170.67 133.22 -169.04 141.20 Q -167.42 149.18 -162.86 155.94 Q -158.30 162.69 -151.51 167.19 Q -144.72 171.69 -136.72 173.24 L -118.37 176.80 Q -118.31 176.82 -118.25 176.83 Q -118.18 176.84 -118.12 176.85 Q -117.31 178.64 -116.33 180.35 Q -115.35 182.05 -114.21 183.65 Q -109.49 190.30 -102.59 194.63 Q -95.69 198.96 -87.66 200.32 L -69.22 203.45 Q -68.74 203.53 -68.27 203.60 Q -67.79 203.67 -67.31 203.73 Q -63.19 213.00 -55.22 219.27 Q -47.25 225.55 -37.27 227.38 L -18.90 230.76 Q -14.56 231.55 -10.15 231.41 Q -5.73 231.26 -1.46 230.18 Q 2.41 233.19 6.88 235.20 Q 11.34 237.21 16.16 238.11 L 34.53 241.54 Q 34.57 241.55 34.60 241.56 Q 34.64 241.56 34.68 241.57 Q 37.13 242.02 39.62 242.17 Q 42.11 242.32 44.60 242.16 Q 50.12 249.01 57.96 252.99 Q 65.80 256.97 74.58 257.39 L 93.24 258.26 Q 94.95 258.34 96.66 258.28 Q 98.37 258.21 100.07 258.01 Q 105.67 262.39 112.42 264.63 Q 119.17 266.87 126.27 266.70 L 144.96 266.26 L 144.99 266.26 Q 146.79 266.22 148.59 266.01 Q 150.38 265.81 152.15 265.45 Q 158.42 269.45 165.70 270.98 Q 172.97 272.52 180.32 271.40 L 198.79 268.59 L 198.83 268.58 Q 215.60 266.01 225.64 252.34 Q 235.68 238.66 233.11 221.89 Q 232.88 220.35 232.63 218.81 L 248.18 211.12 L 248.21 211.11 Q 263.41 203.59 268.84 187.51 Q 274.27 171.44 266.74 156.23 Q 262.68 148.04 257.67 140.39 Q 258.08 139.88 258.48 139.35 Q 258.87 138.83 259.25 138.29 L 269.93 122.97 Q 277.99 111.43 277.25 97.36 Q 276.50 83.30 267.27 72.67 Q 267.91 71.51 268.47 70.30 Q 269.04 69.10 269.52 67.86 L 276.33 50.46 L 276.35 50.40 Q 279.31 42.81 279.14 34.67 Q 278.97 26.52 275.69 19.06 Q 272.55 11.90 266.98 6.40 Q 261.41 0.89 254.21 -2.17 Q 254.51 -3.41 254.73 -4.66 Q 254.96 -5.92 255.10 -7.18 L 257.23 -25.75 Q 258.22 -34.46 255.57 -42.82 Q 252.91 -51.18 247.06 -57.71 Q 247.37 -59.47 247.53 -61.25 Q 247.68 -63.03 247.68 -64.81 L 247.68 -83.54 Q 247.67 -96.77 239.92 -107.49 Q 232.17 -118.21 219.62 -122.38 L 219.52 -129.09 Q 219.26 -146.05 207.09 -157.86 Q 194.92 -169.68 177.96 -169.43 Q 172.94 -169.35 167.85 -169.16 L 167.84 -169.31 L 167.84 -169.34 Q 167.26 -186.29 154.87 -197.87 Q 142.47 -209.45 125.51 -208.88 Q 117.74 -208.61 109.85 -208.00 Q 106.05 -222.95 93.34 -231.68 Q 80.63 -240.40 65.31 -238.58 Q 45.33 -236.20 25.95 -232.73 Q 22.07 -247.33 9.63 -255.91 Q -2.81 -264.48 -17.83 -262.93 Q -44.96 -260.13 -75.59 -250.78 Q -79.88 -250.32 -83.97 -248.97 Q -88.07 -247.62 -91.80 -245.44 Q -103.36 -241.40 -116.91 -235.99 Q -150.38 -254.09 -185.96 -269.59 Q -192.91 -272.62 -200.49 -272.95 Q -208.07 -273.29 -215.27 -270.89 Q -216.07 -270.62 -216.85 -270.33 Q -217.64 -270.03 -218.41 -269.70 Q -261.32 -251.90 -273.54 -218.49 Z"/>
  <path fill="#a88642" d="M -230.34 -169.53 C -242.75 -194.66 -239.90 -216.60 -202.31 -232.03 L -202.31 -232.03 C -175.35 -220.29 -147.49 -206.55 -119.56 -190.60 C -103.63 -197.35 -87.58 -203.79 -71.38 -209.13 L -71.16 -210.06 C -70.64 -209.95 -70.14 -209.84 -69.63 -209.72 C -51.16 -215.71 -32.51 -220.24 -13.63 -222.19 L -11.69 -203.60 C -18.65 -202.88 -25.65 -201.75 -32.69 -200.28 C -18.86 -196.28 -5.65 -191.88 6.97 -187.13 C 28.05 -191.87 49.12 -195.40 70.16 -197.91 L 72.38 -179.35 C 60.85 -177.97 49.33 -176.28 37.81 -174.25 C 47.45 -169.82 56.68 -165.19 65.50 -160.31 C 85.48 -164.46 105.90 -167.22 126.91 -167.94 L 127.53 -149.28 C 114.77 -148.85 102.19 -147.59 89.72 -145.69 C 100.48 -138.62 110.54 -131.19 119.88 -123.44 C 139.03 -126.34 158.55 -128.18 178.56 -128.47 L 178.85 -109.78 C 165.10 -109.58 151.54 -108.61 138.13 -107.03 C 146.65 -98.70 154.45 -90.07 161.53 -81.16 C 176.57 -82.67 191.64 -83.48 206.72 -83.50 L 206.72 -64.81 C 195.94 -64.80 185.15 -64.36 174.35 -63.53 C 178.70 -57.00 182.72 -50.36 186.38 -43.59 C 188.32 -39.99 190.16 -36.35 191.91 -32.68 C 200.12 -32.12 208.33 -31.35 216.53 -30.40 L 214.41 -11.84 C 209.66 -12.39 204.90 -12.86 200.16 -13.28 C 204.99 -0.35 208.65 12.87 211.19 26.25 C 220.15 28.94 229.14 32.00 238.19 35.53 L 231.38 52.94 C 225.61 50.69 219.89 48.60 214.19 46.72 C 215.56 59.97 215.87 73.34 215.16 86.75 C 222.29 90.45 229.37 94.66 236.35 99.53 L 225.66 114.84 C 221.59 112.00 217.47 109.40 213.31 107.00 C 211.78 118.85 209.49 130.70 206.41 142.47 C 215.97 151.68 224.08 162.38 230.03 174.41 L 213.28 182.69 C 209.82 175.69 205.38 169.15 200.19 163.16 C 196.27 174.68 191.60 186.11 186.25 197.37 C 188.93 207.61 191.06 217.85 192.63 228.09 L 174.16 230.91 C 172.83 222.25 171.08 213.58 168.91 204.91 C 160.54 204.65 152.23 204.20 144.00 203.56 C 143.81 210.75 143.82 218.00 144.00 225.31 L 125.31 225.75 C 125.12 217.76 125.12 209.77 125.34 201.81 C 115.61 200.71 106.02 199.31 96.53 197.66 C 95.94 204.19 95.46 210.76 95.16 217.34 L 76.50 216.47 C 76.85 208.96 77.40 201.51 78.09 194.10 C 66.82 191.67 55.75 188.82 44.94 185.60 C 43.99 190.82 43.04 196.05 42.06 201.28 L 23.69 197.84 C 24.80 191.86 25.88 185.85 26.97 179.84 C 15.32 175.79 3.99 171.23 -6.97 166.22 C -8.51 174.30 -10.01 182.39 -11.50 190.47 L -29.88 187.10 C -28.07 177.30 -26.25 167.49 -24.38 157.69 C -36.05 151.58 -47.24 144.90 -57.91 137.63 C -59.44 146.09 -60.93 154.57 -62.38 163.06 L -80.81 159.94 C -78.85 148.41 -76.80 136.89 -74.66 125.38 C -84.83 117.40 -94.38 108.82 -103.31 99.66 C -105.78 111.96 -108.18 124.28 -110.56 136.59 L -128.91 133.03 C -125.64 116.14 -122.30 99.24 -118.84 82.31 C -126.58 72.92 -133.71 63.02 -140.13 52.59 C -141.79 62.81 -143.39 73.06 -145.00 83.31 L -163.47 80.41 C -160.61 62.22 -157.70 43.99 -154.56 25.78 C -162.84 8.07 -169.33 -10.85 -173.78 -30.97 C -176.87 -18.73 -179.80 -6.39 -182.69 6.00 L -200.88 1.75 C -194.65 -24.93 -188.20 -51.67 -180.28 -78.00 C -180.34 -78.89 -180.39 -79.77 -180.44 -80.66 L -179.47 -80.72 C -172.47 -103.66 -164.33 -126.26 -154.19 -148.19 C -179.16 -158.00 -204.57 -165.14 -230.34 -169.53 M -25.91 -178.72 C -39.40 -182.96 -53.58 -186.83 -68.44 -190.28 L -68.44 -190.28 C -78.68 -186.81 -89.00 -182.86 -99.38 -178.66 C -90.90 -173.48 -82.42 -168.10 -74.00 -162.50 C -57.97 -168.72 -41.93 -174.11 -25.91 -178.72 M 5.64 -167.66 C 5.64 -167.66 5.63 -167.65 5.63 -167.66 L 5.63 -167.66 C -14.67 -162.88 -34.94 -156.89 -55.22 -149.56 C -46.91 -143.66 -38.64 -137.56 -30.47 -131.22 C -8.04 -139.55 14.63 -147.37 37.84 -153.66 C 27.65 -158.60 16.92 -163.27 5.66 -167.66 C 5.65 -167.66 5.65 -167.66 5.64 -167.66 M -136.94 -140.94 C -146.66 -119.98 -154.57 -98.17 -161.41 -75.81 C -159.70 -51.76 -155.24 -29.33 -148.31 -8.53 C -140.32 -49.57 -130.31 -90.46 -115.69 -130.75 C -122.72 -134.37 -129.82 -137.76 -136.94 -140.94 M 95.19 -119.13 C 85.12 -126.62 74.26 -133.80 62.56 -140.56 C 36.94 -134.78 11.74 -126.62 -13.40 -117.53 C -5.49 -110.98 2.33 -104.22 10.03 -97.22 C 37.95 -105.53 66.19 -113.36 95.19 -119.13 M -71.44 -104.72 C -80.56 -110.77 -89.76 -116.46 -99.06 -121.75 C -115.97 -74.44 -126.56 -25.84 -135.19 23.38 C -129.04 35.76 -121.89 47.43 -113.87 58.44 C -102.36 4.19 -89.13 -50.22 -71.44 -104.72 M 139.44 -78.47 C 131.88 -87.13 123.53 -95.53 114.38 -103.59 L 114.38 -103.59 C 84.47 -98.53 55.16 -90.83 25.88 -82.31 C 33.85 -74.56 41.70 -66.58 49.34 -58.31 C 79.28 -67.12 109.31 -74.12 139.44 -78.47 M -22.37 -67.75 C -33.21 -76.95 -44.20 -85.58 -55.34 -93.62 C -73.50 -36.79 -86.93 20.16 -98.75 77.28 C -90.13 87.00 -80.74 96.09 -70.65 104.56 C -59.15 46.57 -44.45 -11.13 -22.37 -67.75 M 169.94 -34.69 C 165.02 -43.79 159.40 -52.71 153.06 -61.41 C 123.19 -57.76 93.22 -51.30 63.16 -42.84 C 67.65 -37.64 72.07 -32.34 76.41 -26.94 C 101.98 -31.44 127.56 -33.67 153.09 -33.88 C 158.89 -33.92 164.68 -33.84 170.47 -33.69 C 170.29 -34.02 170.12 -34.35 169.94 -34.69 M 21.07 -26.87 C 11.71 -36.57 2.23 -45.82 -7.41 -54.59 C -28.73 1.60 -42.90 59.16 -54.13 117.44 C -43.57 125.07 -32.39 132.13 -20.63 138.53 C -9.69 83.54 3.17 28.40 21.07 -26.87 M 179.50 -14.69 C 171.49 -15.06 163.47 -15.24 155.47 -15.22 C 133.43 -15.15 111.42 -13.49 89.41 -10.13 C 94.86 -2.81 100.19 4.65 105.34 12.31 C 107.42 12.27 109.50 12.23 111.56 12.22 C 138.67 12.05 164.85 14.76 191.00 20.84 C 188.19 8.79 184.37 -3.08 179.50 -14.69 M 66.34 24.97 C 56.34 12.32 46.12 0.28 35.72 -11.22 L 35.72 -11.22 C 19.22 41.49 7.12 94.33 -3.31 147.31 C 7.52 152.42 18.76 157.03 30.37 161.16 C 38.68 115.57 47.86 69.58 66.34 24.97 M 194.75 41.00 C 169.21 34.32 143.84 31.17 117.31 30.94 L 117.31 30.94 C 123.40 40.80 129.23 50.92 134.78 61.34 C 155.37 65.37 176.27 70.11 196.84 78.34 C 197.13 65.80 196.46 53.32 194.75 41.00 M 101.44 73.03 C 94.28 62.46 87.00 52.21 79.59 42.28 C 64.33 82.45 56.09 124.45 48.31 167.06 C 58.69 170.21 69.32 172.96 80.19 175.34 C 84.74 140.42 92.56 106.48 101.44 73.03 M 195.59 98.09 C 179.43 91.04 162.71 86.42 145.56 82.66 L 145.56 82.66 C 150.27 92.50 154.68 102.61 158.87 112.94 C 169.94 117.04 180.61 122.52 190.37 129.31 C 192.76 118.91 194.51 108.49 195.59 98.09 M 136.28 128.75 C 129.43 116.88 122.41 105.34 115.28 94.13 C 108.22 122.18 102.23 150.35 98.56 178.97 C 107.69 180.58 116.96 181.94 126.34 183.03 C 127.83 164.70 130.88 146.55 136.28 128.75 M 185.13 148.81 C 179.87 144.69 174.22 141.02 168.31 137.81 C 171.85 147.90 175.14 158.22 178.16 168.75 C 180.73 162.13 183.07 155.48 185.13 148.81 M 154.56 161.91 C 152.92 158.79 151.26 155.70 149.59 152.63 C 147.39 163.18 145.89 173.92 145.00 184.84 C 151.12 185.32 157.26 185.71 163.47 185.97 C 160.88 177.96 157.91 169.93 154.56 161.90 Z"/>
</svg>`
    },
    dandelion: {
        name: "Dandelion Petal",
        damage: 8,
        health: 8,
        size: 1.0,
        cooldown: 1000,
        description: "A dandelion petal that provides basic protection",
        color: "#FFD700",
        count: 1,
        image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="300 270 400 400" version="1.1"><path d="M 502 414.084 C 479.881 416.255, 458.437 426.472, 442.455 442.455 C 404.085 480.824, 404.085 543.176, 442.455 581.545 C 480.824 619.915, 543.176 619.915, 581.545 581.545 C 619.915 543.176, 619.915 480.824, 581.545 442.455 C 566.244 427.153, 544.357 416.370, 524.848 414.519 C 511.962 413.297, 510.330 413.266, 502 414.084" stroke="none" fill="#ffffff" fill-rule="evenodd"/><path d="M 387.265 289.475 C 375.100 292.905, 363.007 302.031, 357.747 311.751 C 351.060 324.107, 350.046 340.963, 355.303 352.383 C 356.793 355.619, 367.945 373.712, 380.086 392.589 L 402.161 426.912 413.331 415.648 C 430.397 398.436, 448.887 387.064, 470.735 380.342 C 475.814 378.779, 479.977 377.191, 479.985 376.813 C 480.010 375.690, 436.991 308.877, 433.216 304.175 C 423.467 292.033, 402.258 285.248, 387.265 289.475" stroke="none" fill="#343434" fill-rule="evenodd"/><path d="M 502.500 373.602 C 486.120 375.150, 464.288 381.305, 450.437 388.280 C 430.609 398.265, 408.255 417.790, 396.606 435.298 C 373.700 469.723, 367.539 512.446, 379.631 553 C 390.185 588.393, 417.442 620.069, 451.500 636.521 C 471.575 646.218, 489.516 650.306, 512 650.306 C 549.430 650.306, 583.633 636.197, 609.915 609.915 C 636.197 583.633, 650.306 549.430, 650.306 512 C 650.306 489.516, 646.218 471.575, 636.521 451.500 C 617.370 411.853, 580.183 383.647, 536.500 375.636 C 528.065 374.090, 509.255 372.964, 502.500 373.602 M 502 414.084 C 479.881 416.255, 458.437 426.472, 442.455 442.455 C 404.085 480.824, 404.085 543.176, 442.455 581.545 C 480.824 619.915, 543.176 619.915, 581.545 581.545 C 619.915 543.176, 619.915 480.824, 581.545 442.455 C 566.244 427.153, 544.357 416.370, 524.848 414.519 C 511.962 413.297, 510.330 413.266, 502 414.084" stroke="none" fill="#e4e4e4" fill-rule="evenodd"/></svg>`
    },
    clover: {
        name: "Clover Petal",
        damage: 10,
        health: 10,
        size: 1.0,
        cooldown: 2500,
        description: "A clover petal that provides basic protection",
        color: "#FFD700",
        count: 1,
        image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="625 500 800 800" version="1.1"><path d="M 850 578.059 C 773.207 587.588, 692.146 681.058, 695.310 756.428 C 699.004 844.383, 782.092 905.389, 914 916.997 C 942.947 919.544, 941.226 918.367, 929.754 927.770 C 771.114 1057.800, 774.013 1216.819, 935.763 1257.379 C 1108.499 1300.694, 1189.401 1153.577, 1095.996 966 C 1089.856 953.670, 1089.139 951.442, 1091.635 952.453 C 1216.150 1002.872, 1316.924 991.912, 1369.413 922.243 C 1421.654 852.904, 1381.120 708.014, 1299.463 672.201 C 1218.326 636.617, 1129.087 680.446, 1050.964 794.250 C 1042.127 807.123, 1042.643 806.992, 1041.116 796.750 C 1019.979 654.987, 942.699 566.556, 850 578.059 M 856.841 632.077 C 801.463 637.949, 739.896 714.900, 750.336 765.196 C 763.855 830.325, 835.239 864.332, 963.381 866.693 C 1000.532 867.377, 996.988 870.764, 993.412 838 C 978.382 700.275, 928.139 624.518, 856.841 632.077 M 1230.500 714.674 C 1176.322 721.435, 1121.526 772.679, 1067.449 867.155 C 1063.352 874.312, 1060 880.385, 1060 880.649 C 1060 882.029, 1101.282 900.076, 1122.472 907.960 C 1275.620 964.937, 1370.449 911.816, 1330.485 791.438 C 1311.932 735.556, 1277.151 708.852, 1230.500 714.674 M 1009 933.808 C 894.388 1013.818, 847.951 1087.918, 873.045 1150.752 C 896.868 1210.403, 1010.642 1233.669, 1055.978 1188.161 C 1100.845 1143.124, 1090.833 1060.299, 1026.948 948 C 1014.990 926.980, 1016.767 928.385, 1009 933.808" stroke="none" fill="#2e933c" fill-rule="evenodd"/><path d="M 856.841 632.077 C 801.463 637.949, 739.896 714.900, 750.336 765.196 C 763.855 830.325, 835.239 864.332, 963.381 866.693 C 1000.532 867.377, 996.988 870.764, 993.412 838 C 978.382 700.275, 928.139 624.518, 856.841 632.077 M 1230.500 714.674 C 1176.322 721.435, 1121.526 772.679, 1067.449 867.155 C 1063.352 874.312, 1060 880.385, 1060 880.649 C 1060 882.029, 1101.282 900.076, 1122.472 907.960 C 1275.620 964.937, 1370.449 911.816, 1330.485 791.438 C 1311.932 735.556, 1277.151 708.852, 1230.500 714.674 M 1009 933.808 C 894.388 1013.818, 847.951 1087.918, 873.045 1150.752 C 896.868 1210.403, 1010.642 1233.669, 1055.978 1188.161 C 1100.845 1143.124, 1090.833 1060.299, 1026.948 948 C 1014.990 926.980, 1016.767 928.385, 1009 933.808" stroke="none" fill="#39b54a" fill-rule="evenodd"/></svg>`,
    },
    bone: {
        name: "Bone Petal",
        health: 15,
        damage: 12,
        size: 1.0,
        cooldown: 1500,
        description: "A bone petal",
        color: "#FFFFFF",
        count: 1,
        image: `<svg 
  xmlns="http://www.w3.org/2000/svg" 
  width="32" 
  height="32"
  viewBox="-25 -15 50 30">
  <g transform="scale(S)">
    <path 
      fill="#FFFFFF" 
      stroke="#CFCFCF" 
      stroke-width="1"
      vector-effect="non-scaling-stroke"
      d="M -10 -4 
         Q 0 0 10 -4
         C 14 -10 20 -2 14 0
         C 20 2 14 10 10 4
         Q 0 0 -10 4
         C -14 10 -20 2 -14 0
         C -20 -2 -14 -10 -10 -4 Z"
    />
  </g>
</svg>`
    },
    cactus: {
        name: "Cactus Petal",
        damage: 15,
        health: 15,
        size: 1.0,
        cooldown: 1000,
        description: "Not very strong, but gives extra health",
        color: "#000000",
        count: 1,
        image: `<svg width="40" height="40" viewBox="-20 -20 40 40" xmlns="http://www.w3.org/2000/svg">
  <path d="M 15 0 Q 11.087 4.592 10.607 10.607 Q 4.592 11.087 0 15 Q -4.592 11.087 -10.607 10.607 Q -11.087 4.592 -15 0 Q -11.087 -4.592 -10.607 -10.607 Q -4.592 -11.087 0 -15 Q 4.592 -11.087 10.607 -10.607 Q 11.087 -4.592 15 0 Z"
        fill="#38c75f"
        stroke="#2d9f4c"
        stroke-width="3"
        stroke-linecap="round"
        stroke-linejoin="round" />
  <circle cx="0"
          cy="0"
          r="8"
          fill="#74d68f" />
</svg>`,
        playerModifiers: {
            maxHealth: 1.1,
        },
        isAdminPetal: false
    },
    poison_cactus: {
        name: "Poison Cactus Petal",
        damage: 15,
        health: 15,
        size: 1.0,
        cooldown: 600,
        poison: 0.005, // 0.005 damage per millisecond (5 damage per second)
        poisonDuration: 3000, // Poison lasts for 3 seconds after contact
        description: "Not very strong, but poisons enemies and gives extra health",
        color: "#000000",
        count: 1,
        image: `<svg width="40" height="40" viewBox="-20 -20 40 40" xmlns="http://www.w3.org/2000/svg">
  <path d="M 15 0 Q 11.087 4.592 10.607 10.607 Q 4.592 11.087 0 15 Q -4.592 11.087 -10.607 10.607 Q -11.087 4.592 -15 0 Q -11.087 -4.592 -10.607 -10.607 Q -4.592 -11.087 0 -15 Q 4.592 -11.087 10.607 -10.607 Q 11.087 -4.592 15 0 Z"
        fill="#ce76db"
        stroke="#a760b1"
        stroke-width="3"
        stroke-linecap="round"
        stroke-linejoin="round" />
  <circle cx="0"
          cy="0"
          r="8"
          fill="#cea0db" />
</svg>`,
        playerModifiers: {
            maxHealth: 1.06,
        },
        isAdminPetal: false
    },
    iris: {
        name: "Iris Petal",
        damage: 0,
        health: 1,
        size: 0.7,
        cooldown: 1000,
        poison: 0.009,
        poisonDuration: 1000,
        description: "Very poisonous",
        color: "#000000",
        count: 1,
        image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="14" fill="#ce76db" stroke-width="4" stroke="#a760b1"/>
</svg>`,
        isAdminPetal: false
    },
    lightning: {
        name: "Lightning Petal",
        damage: 25, // Base damage that will scale with rarity (25 × rarity multiplier)
        health: 10, // Increased health so it doesn't break immediately
        cooldown: 700,
        size: 1.0,
        count: 1,
        description: "A petal that strikes lightning at multiple enemies in a radius",
        color: "#FFFFFF",
        image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="310 300 400 400" version="1.1"><path d="M 500.045 396.029 L 488.590 435.045 487.913 436.141 L 487.235 437.237 454.557 412.013 L 421.878 386.789 421.416 387.251 L 420.955 387.712 434.610 426.390 L 448.264 465.069 447.732 465.602 L 447.199 466.134 408.850 464.961 L 370.500 463.789 367.532 464.144 L 364.563 464.500 398.782 487.979 L 433 511.457 433 512 L 433 512.543 398.782 536.021 L 364.563 559.500 367.532 559.856 L 370.500 560.211 408.850 559.039 L 447.199 557.866 447.732 558.398 L 448.264 558.931 434.610 597.610 L 420.955 636.288 421.413 636.746 L 421.871 637.204 454.543 611.967 L 487.215 586.730 487.945 587.912 L 488.676 589.093 500.088 628.043 L 511.500 666.992 512 666.992 L 512.500 666.992 523.912 628.043 L 535.324 589.093 536.055 587.912 L 536.785 586.730 569.457 611.967 L 602.129 637.204 602.587 636.746 L 603.045 636.288 589.390 597.610 L 575.736 558.931 576.268 558.398 L 576.801 557.866 615.150 559.039 L 653.500 560.211 656.468 559.856 L 659.437 559.500 625.218 536.021 L 591 512.543 591 512 L 591 511.457 625.218 487.979 L 659.437 464.500 656.468 464.144 L 653.500 463.789 615.150 464.961 L 576.801 466.134 576.268 465.602 L 575.736 465.069 589.390 426.390 L 603.045 387.712 602.584 387.251 L 602.122 386.789 569.443 412.013 L 536.765 437.237 536.087 436.141 L 535.410 435.045 523.955 396.029 L 512.500 357.013 512 357.013 L 511.500 357.013 500.045 396.029 M 503.500 432.502 L 495.500 460 495 459.988 L 494.500 459.976 472 442.628 L 449.500 425.281 449.147 425.577 L 448.794 425.873 458.026 451.687 L 467.259 477.500 467.783 478.873 L 468.308 480.245 438.904 479.540 L 409.500 478.835 411.500 480.291 L 413.500 481.746 435 496.430 L 456.500 511.113 456.770 511.867 L 457.040 512.621 440.433 523.925 L 423.826 535.230 416.663 540.223 L 409.500 545.215 438.893 544.515 L 468.285 543.814 467.799 545.157 L 467.312 546.500 458.057 572.317 L 448.802 598.135 449.151 598.452 L 449.500 598.769 472 581.396 L 494.500 564.023 495 564.021 L 495.500 564.018 503.500 591.507 L 511.500 618.996 512 618.996 L 512.500 618.996 520.500 591.507 L 528.500 564.018 529 564.021 L 529.500 564.023 552 581.396 L 574.500 598.769 574.849 598.452 L 575.198 598.135 565.943 572.317 L 556.688 546.500 556.201 545.157 L 555.715 543.814 585.107 544.521 L 614.500 545.228 590.750 528.987 L 567 512.747 567 512.055 L 567 511.363 576.750 504.748 L 586.500 498.133 600.500 488.480 L 614.500 478.828 585.096 479.537 L 555.692 480.245 556.217 478.873 L 556.741 477.500 565.974 451.687 L 575.206 425.873 574.853 425.577 L 574.500 425.281 552 442.628 L 529.500 459.976 529 459.988 L 528.500 460 520.500 432.502 L 512.500 405.005 512 405.005 L 511.500 405.005 503.500 432.502" stroke="none" fill="#24c4bc" fill-rule="evenodd"/><path d="M 503.500 432.502 L 495.500 460 495 459.988 L 494.500 459.976 472 442.628 L 449.500 425.281 449.147 425.577 L 448.794 425.873 458.026 451.687 L 467.259 477.500 467.783 478.873 L 468.308 480.245 438.904 479.540 L 409.500 478.835 411.500 480.291 L 413.500 481.746 435 496.430 L 456.500 511.113 456.770 511.867 L 457.040 512.621 440.433 523.925 L 423.826 535.230 416.663 540.223 L 409.500 545.215 438.893 544.515 L 468.285 543.814 467.799 545.157 L 467.312 546.500 458.057 572.317 L 448.802 598.135 449.151 598.452 L 449.500 598.769 472 581.396 L 494.500 564.023 495 564.021 L 495.500 564.018 503.500 591.507 L 511.500 618.996 512 618.996 L 512.500 618.996 520.500 591.507 L 528.500 564.018 529 564.021 L 529.500 564.023 552 581.396 L 574.500 598.769 574.849 598.452 L 575.198 598.135 565.943 572.317 L 556.688 546.500 556.201 545.157 L 555.715 543.814 585.107 544.521 L 614.500 545.228 590.750 528.987 L 567 512.747 567 512.055 L 567 511.363 576.750 504.748 L 586.500 498.133 600.500 488.480 L 614.500 478.828 585.096 479.537 L 555.692 480.245 556.217 478.873 L 556.741 477.500 565.974 451.687 L 575.206 425.873 574.853 425.577 L 574.500 425.281 552 442.628 L 529.500 459.976 529 459.988 L 528.500 460 520.500 432.502 L 512.500 405.005 512 405.005 L 511.500 405.005 503.500 432.502" stroke="none" fill="#2bf3e3" fill-rule="evenodd"/></svg>`,
        actions: `wait_until_collision; lightning 1000;`
    },
    missile: {
        name: "Missile Petal",
        damage: 10,
        health: 10,
        size: 1.0,
        cooldown: 2000,
        description: "It's shootable",
        color: "#000000",
        count: 1,
        image: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <!-- 
    The triangle is drawn and then rotated 90 degrees clockwise around its center point (16, 16).
    The original points were (0,32), (28,32), (14,0).
    After rotation and centering within a 32x32 canvas, the points are adjusted to fit the new dimensions.
  -->
  <polygon 
    points="32,32 32,4 0,18"
    fill="#000000" 
    transform="rotate(180 16 16) translate(0, -2)" />
</svg>`,
        isAdminPetal: false,
        projectile: {
            count: 1,
            distance: 500,
            speed: 300,
            spreadAngle: 0.0
        }
    },
    jelly: {
        name: "Jelly Petal",
        damage: 1,
        health: 100,
        size: 1.0,
        cooldown: 1000,
        knockback: 15.0,
        description: "Sticky and bouncy",
        color: "#000000",
        count: 1,
        image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="14.5" fill="rgba(255, 128, 255, 0.2)" stroke="rgba(255, 128, 255, 0.5)" stroke-width="3"/>
<circle cx="12" cy="12" r="2" fill="rgba(255, 128, 255, 0.5)"/>
<circle cx="25" cy="17" r="3" fill="rgba(255, 128, 255, 0.5)"/>
<circle cx="12" cy="25" r="2.5" fill="rgba(255, 128, 255, 0.5)"/>
</svg>`,
        isAdminPetal: false
    },
    yucca: {
        name: "Yucca Petal",
        damage: 10,
        health: 10,
        size: 1.0,
        cooldown: 1000,
        description: "It heals",
        color: "#000000",
        count: 1,
        passiveHeal: 1, // Base heal: 1 HP/sec at common
        image: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <path d="M30 16 Q16 4 2 16 Q16 28 30 16 Z" 
        fill="#74b53f" 
        stroke="#5e9333" 
        stroke-width="3" 
        stroke-linecap="round" 
        stroke-linejoin="round" />
        
  <path d="M30 16 Q16 13 2 16" 
        fill="none" 
        stroke="#5e9333" 
        stroke-width="2" 
        stroke-linecap="round" 
        stroke-linejoin="round" />
</svg>`,
        isAdminPetal: false
    },
    leaf: {
        name: "Leaf Petal",
        damage: 10,
        health: 10,
        size: 1.0,
        cooldown: 1000,
        description: "It heals",
        color: "#000000",
        count: 1,
        passiveHeal: 1, // Base heal: 1 HP/sec at common
        image: `<svg width="32" height="32" viewBox="-21.5 -10.5 38 21" xmlns="http://www.w3.org/2000/svg">
  <path d="M -20 0 
           L -15 0 
           C -10 -12, 5 -12, 15 0 
           C 5 12, -10 12, -15 0" 
        fill="#39b54a" 
        stroke="#2e933c" 
        stroke-width="3" 
        stroke-linecap="round" 
        stroke-linejoin="round"/>
  <path d="M -9 0 
           Q 0 -1.5, 7.5 0" 
        fill="none" 
        stroke="#2e933c" 
        stroke-width="3" 
        stroke-linecap="round" 
        stroke-linejoin="round"/>
</svg>`,
        isAdminPetal: false
    },
    cutter: {
        name: "Cutter Petal",
        damage: 1,
        health: Infinity,
        size: 7.0,
        cooldown: 1,
        description: "It increases your body damage",
        knockback: 5,
        color: "#000000",
        speed: 2.0,
        count: 1,
        range: 0.0,
        equipFlags: EquipmentFlags.Cutter,
        noPhysics: true,
        image: `<svg width="32" height="32" viewBox="-40 -40 80 80" xmlns="http://www.w3.org/2000/svg">
  <path fill="#111111" fill-rule="evenodd" d="
    M 25 0 A 25 25 0 1 0 -25 0 A 25 25 0 1 0 25 0
    M 24.749 24.749
    Q 9.899 23.899 0 35
    Q -9.899 23.899 -24.749 24.749
    Q -23.899 9.899 -35 0
    Q -23.899 -9.899 -24.749 -24.749
    Q -9.899 -23.899 0 -35
    Q 9.899 -23.899 24.749 -24.749
    Q 23.899 -9.899 35 0
    Q 23.899 9.899 24.749 24.749
    Z" 
  />
</svg>`,
        isAdminPetal: false
    },
    lightning_cutter: {
        name: "Lightning Cutter Petal",
        damage: 1,
        health: Infinity,
        size: 7.0,
        cooldown: 1,
        description: "It increases your body damage and has lightning",
        knockback: 5,
        color: "#000000",
        actions: "lightning 1000; break;",
        speed: 2.0,
        count: 1,
        range: 0.0,
        equipFlags: EquipmentFlags.Cutter,
        noPhysics: true,
        image: `<svg width="32" height="32" viewBox="-40 -40 80 80" xmlns="http://www.w3.org/2000/svg">
  <path fill="#00ffff" fill-rule="evenodd" d="
    M 25 0 A 25 25 0 1 0 -25 0 A 25 25 0 1 0 25 0
    M 24.749 24.749
    Q 9.899 23.899 0 35
    Q -9.899 23.899 -24.749 24.749
    Q -23.899 9.899 -35 0
    Q -23.899 -9.899 -24.749 -24.749
    Q -9.899 -23.899 0 -35
    Q 9.899 -23.899 24.749 -24.749
    Q 23.899 -9.899 35 0
    Q 23.899 9.899 24.749 24.749
    Z" 
  />
</svg>`,
        isAdminPetal: false
    },
    wing: {
        name: "Wing Petal",
        damage: 20,
        health: 10,
        size: 1.0,
        cooldown: 2500,
        range: 2.0,
        description: "It comes and goes",
        color: "#000000",
        count: 1,
        image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<path d="M 20 0 Q -5 16 20 32 M 20 32 Q 10 16 20 0 M 20 0 Z" stroke="#e6e6e6" stroke-width="2" fill="#ffffff" stroke-linecap="round"/>
</svg>`,
        isAdminPetal: false
    },
    square: {
        name: "Square Petal",
        damage: 10,
        health: 10,
        size: 1.0,
        cooldown: 1000,
        description: "It's a square",
        color: "#000000",
        count: 1,
        image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<rect width="28" height="28" x="2" y="2" fill="#ffe869"/>
<path d="M 2 2 L 2 30 M 2 30 L 30 30 M 30 30 L 30 2 M 30 2 L 2 2 M 2 2 Z" stroke="#cfbc55" stroke-linecap="round" stroke-width="3"/>
</svg>`,
        isAdminPetal: false
    },
    golden_leaf: {
        name: "Golden Leaf Petal",
        damage: 1,
        health: 100,
        size: 1.2,
        cooldown: 200,
        description: "It respawns very quickly, but not very strong",
        color: "#000000",
        count: 1,
        image: `<svg width="32" height="32" viewBox="-21.5 -10.5 38 21" xmlns="http://www.w3.org/2000/svg">
  <path d="M -20 0 
           L -15 0 
           C -10 -12, 5 -12, 15 0 
           C 5 12, -10 12, -15 0" 
        fill="#ebeb34" 
        stroke="#bebe2a" 
        stroke-width="3" 
        stroke-linecap="round" 
        stroke-linejoin="round"/>
  <path d="M -9 0 
           Q 0 -1.5, 7.5 0" 
        fill="none" 
        stroke="#bebe2a" 
        stroke-width="3" 
        stroke-linecap="round" 
        stroke-linejoin="round"/>
</svg>`,
        isAdminPetal: false
    },
    blood_leaf: {
        name: "Blood Leaf Petal",
        damage: 0.6,
        health: 500,
        size: 1.5,
        cooldown: 1500,
        description: "Explodes and damages the player",
        color: "#000000",
        count: 1,
        actions: blood_leaf_action,
        image: `<svg width="32" height="32" viewBox="-21.5 -10.5 38 21" xmlns="http://www.w3.org/2000/svg">
  <path d="M -20 0 
           L -15 0 
           C -10 -12, 5 -12, 15 0 
           C 5 12, -10 12, -15 0" 
        fill="#ad0000" 
        stroke="#780000" 
        stroke-width="3" 
        stroke-linecap="round" 
        stroke-linejoin="round"/>
  <path d="M -9 0 
           Q 0 -1.5, 7.5 0" 
        fill="none" 
        stroke="#780000" 
        stroke-width="3" 
        stroke-linecap="round" 
        stroke-linejoin="round"/>
</svg>`,
        isAdminPetal: false
    },
    bulb: {
        name: "Bulb Petal",
        damage: 8,
        health: 10,
        size: 1.5,
        cooldown: 627,
        description: "A lightbulb, but it's not very strong",
        color: "#ffff00",
        count: 3,
        emissive: true,
        lightRadius: 50,
        lightColor: "#ffff00",
        image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
  <rect x="12" y="12" width="8" height="16" fill="#aaaaaa" stroke-width="2" stroke="#999999"/>
  <rect x="12" y="19" width="8" height="2" fill="#999999" stroke-width="0" stroke="#999999"/>
  <rect x="12" y="23" width="8" height="2" fill="#999999" stroke-width="0" stroke="#999999"/>
  <circle r="8" cx="16" cy="10" fill="#ffff00" stroke-width="2" stroke="#aaaa00"/>
</svg>`,
        isAdminPetal: false
    },
    gas: {
        name: "Gas Petal",
        damage: 0.0,
        health: Infinity,
        poison: 0.002,
        size: 1.0,
        cooldown: 800,
        description: "Toxic gas that deals damage to enemies",
        color: "#000000",
        count: 1,
        image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
  <circle cx="16" cy="16" r="16" fill="rgba(0, 255, 0, 0.5)"/>
</svg>`,
        isAdminPetal: false,
        projectile: {
            count: 10,
            distance: 500,
            speed: 50,
            spreadAngle: 1.0
        }
    },
    starfish: {
        name: "Starfish Petal",
        damage: 10,
        health: 10,
        size: 1.0,
        cooldown: 2000,
        description: "Heals if below 75% health",
        color: "#000000",
        count: 1,
        actions: "if memory:player:health < 75; heal 25; endif;",
        image: `<?xml version="1.0" encoding="utf-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32px" height="32px">
  <path d="M 0.0 11.0 C 32.0 16.0 32.0 16.00 0.0 21" stroke="#ed5c79" stroke-width="3" fill="#fc6f8b"/>
  <circle cx="5" cy="16" r="2.495" fill="#ed5c79" stroke="rgba(0, 0, 0, 0)"/>
  <circle cx="10" cy="16" r="1.5" fill="#ed5c79" stroke="rgba(0, 0, 0, 0)" style="stroke-width: 1;"/>
</svg>`,
        isAdminPetal: false
    },
    sponge: {
        name: "Sponge Petal",
        damage: 10,
        health: 10,
        size: 1.0,
        cooldown: 2000,
        description: "Absorbs damage",
        color: "#000000",
        count: 1,
        image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="-40 -40 80 80">
  
  <path fill="#ff96e0" d="
    M 30 0 
    Q 32.53 0.54 33.93 2.7 
    Q 35.34 4.87 34.8 7.4 
    Q 34.27 9.93 32.1 11.33 
    Q 29.93 12.74 27.41 12.2 
    Q 29.5 13.72 29.9 16.27 
    Q 30.3 18.82 28.79 20.91 
    Q 27.27 23 24.72 23.41 
    Q 22.16 23.81 20.07 22.29 
    Q 20.07 22.29 20.07 22.29 
    Q 21.37 24.53 20.7 27.03 
    Q 20.03 29.52 17.79 30.81 
    Q 15.55 32.11 13.06 31.44 
    Q 10.56 30.77 9.27 28.53 
    Q 9.54 31.1 7.91 33.11 
    Q 6.29 35.12 3.72 35.39 
    Q 1.15 35.66 -0.86 34.03 
    Q -2.87 32.41 -3.14 29.84 
    Q -3.93 32.29 -6.24 33.47 
    Q -8.54 34.64 -11 33.84 
    Q -13.45 33.04 -14.63 30.74 
    Q -15.8 28.44 -15 25.98 
    Q -16.73 27.9 -19.31 28.04 
    Q -21.89 28.17 -23.81 26.44 
    Q -25.73 24.71 -25.86 22.13 
    Q -26 19.55 -24.27 17.63 
    Q -26.63 18.68 -29.04 17.76 
    Q -31.45 16.83 -32.51 14.47 
    Q -33.56 12.11 -32.63 9.7 
    Q -31.7 7.29 -29.34 6.24 
    Q -31.93 6.24 -33.75 4.41 
    Q -35.58 2.58 -35.58 0 
    Q -35.58 -2.58 -33.75 -4.41 
    Q -31.93 -6.24 -29.34 -6.24 
    Q -31.7 -7.29 -32.63 -9.7 
    Q -33.56 -12.11 -32.51 -14.47 
    Q -31.45 -16.83 -29.04 -17.76 
    Q -26.63 -18.68 -24.27 -17.63 
    Q -26 -19.55 -25.86 -22.13 
    Q -25.73 -24.71 -23.81 -26.44 
    Q -21.89 -28.17 -19.31 -28.04 
    Q -16.73 -27.9 -15 -25.98 
    Q -15.8 -28.44 -14.63 -30.74 
    Q -13.45 -33.04 -11 -33.84 
    Q -8.54 -34.64 -6.24 -33.47 
    Q -3.93 -32.29 -3.14 -29.84 
    Q -2.87 -32.41 -0.86 -34.03 
    Q 1.15 -35.66 3.72 -35.39 
    Q 6.29 -35.12 7.91 -33.11 
    Q 9.54 -31.1 9.27 -28.53 
    Q 10.56 -30.77 13.06 -31.44 
    Q 15.55 -32.11 17.79 -30.81 
    Q 20.03 -29.52 20.7 -27.03 
    Q 21.37 -24.53 20.07 -22.29 
    Q 22.16 -23.81 24.72 -23.41 
    Q 27.27 -23 28.79 -20.91 
    Q 30.3 -18.82 29.9 -16.27 
    Q 29.5 -13.72 27.41 -12.2 
    Q 27.41 -12.2 27.41 -12.2 
    Q 29.93 -12.74 32.1 -11.33 
    Q 34.27 -9.92 34.8 -7.4 
    Q 35.34 -4.87 33.93 -2.7 
    Q 32.53 -0.54 30 0 
    L 30 0 Z" />

  <path fill="#b2699c" d="
    M 30.42 -1.96 
    Q 33.75 -1.25 35.61 1.61 
    Q 37.47 4.48 36.76 7.81 
    Q 36.05 11.15 33.19 13.01 
    Q 30.33 14.87 26.99 14.16 
    L 27.41 12.2 
    L 28.58 10.58 
    Q 31.34 12.59 31.88 15.96 
    Q 32.41 19.33 30.4 22.09 
    Q 28.4 24.85 25.03 25.38 
    Q 21.66 25.92 18.9 23.91 
    L 20.07 22.29 
    L 21.81 21.29 
    Q 23.51 24.25 22.63 27.55 
    Q 21.75 30.84 18.79 32.55 
    Q 15.84 34.25 12.54 33.37 
    Q 9.24 32.49 7.54 29.53 
    L 9.27 28.53 
    L 11.26 28.32 
    Q 11.62 31.72 9.47 34.37 
    Q 7.32 37.02 3.93 37.38 
    Q 0.54 37.73 -2.12 35.59 
    Q -4.77 33.44 -5.12 30.04 
    L -3.14 29.84 
    L -1.23 30.45 
    Q -2.29 33.7 -5.33 35.25 
    Q -8.37 36.8 -11.61 35.74 
    Q -14.86 34.69 -16.41 31.65 
    Q -17.96 28.61 -16.9 25.36 
    L -15 25.98 
    L -13.51 27.32 
    Q -15.8 29.85 -19.2 30.03 
    Q -22.61 30.21 -25.15 27.93 
    Q -27.68 25.65 -27.86 22.24 
    Q -28.04 18.83 -25.76 16.3 
    L -24.27 17.63 
    L -23.46 19.46 
    Q -26.57 20.85 -29.76 19.63 
    Q -32.94 18.4 -34.33 15.29 
    Q -35.72 12.17 -34.5 8.98 
    Q -33.27 5.8 -30.16 4.41 
    L -29.34 6.24 
    L -29.34 8.24 
    Q -32.76 8.24 -35.17 5.82 
    Q -37.58 3.41 -37.58 0 
    Q -37.58 -3.41 -35.17 -5.82 
    Q -32.76 -8.24 -29.34 -8.24 
    L -29.34 -6.24 
    L -30.16 -4.41 
    Q -33.27 -5.8 -34.5 -8.98 
    Q -35.72 -12.17 -34.33 -15.29 
    Q -32.94 -18.4 -29.76 -19.63 
    Q -26.57 -20.85 -23.46 -19.46 
    L -24.27 -17.63 
    L -25.76 -16.3 
    Q -28.04 -18.83 -27.86 -22.24 
    Q -27.68 -25.65 -25.15 -27.93 
    Q -22.61 -30.21 -19.2 -30.03 
    Q -15.8 -29.85 -13.51 -27.32 
    L -15 -25.98 
    L -16.9 -25.36 
    Q -17.96 -28.61 -16.41 -31.65 
    Q -14.86 -34.69 -11.61 -35.74 
    Q -8.37 -36.8 -5.33 -35.25 
    Q -2.29 -33.7 -1.23 -30.45 
    L -3.14 -29.84 
    L -5.12 -30.04 
    Q -4.77 -33.44 -2.12 -35.59 
    Q 0.54 -37.73 3.93 -37.38 
    Q 7.32 -37.02 9.47 -34.37 
    Q 11.62 -31.72 11.26 -28.32 
    L 9.27 -28.53 
    L 7.54 -29.53 
    Q 9.24 -32.49 12.54 -33.37 
    Q 15.84 -34.25 18.79 -32.55 
    Q 21.75 -30.84 22.63 -27.54 
    Q 23.51 -24.25 21.81 -21.29 
    L 20.07 -22.29 
    L 18.9 -23.91 
    Q 21.66 -25.92 25.03 -25.38 
    Q 28.4 -24.85 30.4 -22.09 
    Q 32.41 -19.33 31.88 -15.96 
    Q 31.34 -12.59 28.58 -10.58 
    L 27.41 -12.2 
    L 26.99 -14.16 
    Q 30.33 -14.87 33.19 -13.01 
    Q 36.05 -11.15 36.76 -7.81 
    Q 37.47 -4.48 35.61 -1.61 
    Q 33.75 1.25 30.42 1.96 
    L 30 0 
    L 30.42 -1.96 
    L 30.42 -1.96 Z 
    M 29.58 1.96 
    Q 29 1.83 28.59 1.41 
    Q 28.17 1 28.04 0.42 
    Q 27.87 -0.39 28.32 -1.09 
    Q 28.77 -1.78 29.58 -1.96 
    Q 31.3 -2.32 32.26 -3.79 
    Q 33.21 -5.27 32.85 -6.98 
    Q 32.48 -8.7 31.01 -9.65 
    Q 29.54 -10.61 27.82 -10.25 
    Q 27.24 -10.12 26.69 -10.33 
    Q 26.14 -10.55 25.79 -11.03 
    Q 25.3 -11.7 25.43 -12.51 
    Q 25.56 -13.33 26.23 -13.82 
    Q 27.65 -14.85 27.93 -16.59 
    Q 28.2 -18.32 27.17 -19.74 
    Q 26.14 -21.16 24.4 -21.43 
    Q 22.67 -21.71 21.25 -20.68 
    Q 20.77 -20.33 20.18 -20.3 
    Q 19.59 -20.27 19.07 -20.56 
    Q 18.36 -20.98 18.14 -21.78 
    Q 17.93 -22.58 18.34 -23.29 
    Q 19.22 -24.81 18.77 -26.51 
    Q 18.31 -28.21 16.79 -29.08 
    Q 15.27 -29.96 13.58 -29.51 
    Q 11.88 -29.05 11 -27.53 
    Q 10.71 -27.02 10.18 -26.75 
    Q 9.65 -26.48 9.06 -26.54 
    Q 8.24 -26.63 7.72 -27.27 
    Q 7.19 -27.92 7.28 -28.74 
    Q 7.46 -30.49 6.36 -31.85 
    Q 5.26 -33.21 3.51 -33.4 
    Q 1.76 -33.58 0.4 -32.48 
    Q -0.96 -31.37 -1.15 -29.63 
    Q -1.21 -29.04 -1.58 -28.58 
    Q -1.95 -28.12 -2.52 -27.93 
    Q -3.31 -27.68 -4.04 -28.05 
    Q -4.78 -28.43 -5.04 -29.22 
    Q -5.58 -30.89 -7.14 -31.68 
    Q -8.71 -32.48 -10.38 -31.94 
    Q -12.05 -31.4 -12.84 -29.83 
    Q -13.64 -28.27 -13.1 -26.6 
    Q -12.91 -26.04 -13.07 -25.46 
    Q -13.22 -24.89 -13.66 -24.49 
    Q -14.28 -23.94 -15.1 -23.98 
    Q -15.93 -24.03 -16.49 -24.64 
    Q -17.66 -25.95 -19.41 -26.04 
    Q -21.17 -26.13 -22.47 -24.96 
    Q -23.77 -23.78 -23.87 -22.03 
    Q -23.96 -20.28 -22.78 -18.97 
    Q -22.39 -18.53 -22.3 -17.95 
    Q -22.2 -17.36 -22.44 -16.82 
    Q -22.78 -16.06 -23.55 -15.77 
    Q -24.33 -15.47 -25.08 -15.81 
    Q -26.69 -16.52 -28.33 -15.89 
    Q -29.96 -15.26 -30.68 -13.66 
    Q -31.39 -12.06 -30.76 -10.42 
    Q -30.13 -8.78 -28.53 -8.06 
    Q -27.99 -7.82 -27.67 -7.33 
    Q -27.34 -6.83 -27.34 -6.24 
    Q -27.34 -5.41 -27.93 -4.82 
    Q -28.52 -4.24 -29.34 -4.24 
    Q -31.1 -4.24 -32.34 -3 
    Q -33.58 -1.76 -33.58 0 
    Q -33.58 1.76 -32.34 3 
    Q -31.1 4.24 -29.34 4.24 
    Q -28.75 4.24 -28.26 4.56 
    Q -27.76 4.88 -27.52 5.42 
    Q -27.18 6.18 -27.48 6.95 
    Q -27.77 7.73 -28.53 8.06 
    Q -30.13 8.78 -30.76 10.42 
    Q -31.39 12.06 -30.68 13.66 
    Q -29.96 15.26 -28.33 15.89 
    Q -26.69 16.52 -25.08 15.81 
    Q -24.54 15.57 -23.96 15.66 
    Q -23.37 15.75 -22.93 16.15 
    Q -22.32 16.7 -22.27 17.53 
    Q -22.23 18.36 -22.78 18.97 
    Q -23.96 20.28 -23.87 22.03 
    Q -23.77 23.78 -22.47 24.96 
    Q -21.17 26.13 -19.41 26.04 
    Q -17.66 25.95 -16.49 24.64 
    Q -16.09 24.2 -15.52 24.05 
    Q -14.95 23.9 -14.38 24.08 
    Q -13.59 24.33 -13.22 25.07 
    Q -12.84 25.81 -13.1 26.6 
    Q -13.64 28.27 -12.84 29.83 
    Q -12.05 31.4 -10.38 31.94 
    Q -8.71 32.48 -7.14 31.68 
    Q -5.58 30.89 -5.04 29.22 
    Q -4.85 28.65 -4.39 28.28 
    Q -3.93 27.91 -3.34 27.85 
    Q -2.52 27.76 -1.88 28.28 
    Q -1.23 28.8 -1.15 29.63 
    Q -0.96 31.37 0.4 32.48 
    Q 1.76 33.58 3.51 33.4 
    Q 5.26 33.21 6.36 31.85 
    Q 7.46 30.49 7.28 28.74 
    Q 7.22 28.15 7.49 27.62 
    Q 7.76 27.1 8.27 26.8 
    Q 8.99 26.39 9.79 26.6 
    Q 10.59 26.81 11 27.53 
    Q 11.88 29.05 13.58 29.51 
    Q 15.27 29.96 16.79 29.08 
    Q 18.31 28.21 18.77 26.51 
    Q 19.22 24.81 18.34 23.29 
    Q 18.05 22.78 18.08 22.19 
    Q 18.11 21.6 18.46 21.12 
    Q 18.94 20.45 19.76 20.32 
    Q 20.58 20.19 21.25 20.68 
    Q 22.67 21.71 24.4 21.43 
    Q 26.14 21.16 27.17 19.74 
    Q 28.2 18.32 27.93 16.59 
    Q 27.65 14.85 26.23 13.82 
    Q 25.75 13.47 25.54 12.92 
    Q 25.33 12.37 25.45 11.79 
    Q 25.62 10.98 26.32 10.52 
    Q 27.01 10.07 27.82 10.25 
    Q 29.54 10.61 31.01 9.65 
    Q 32.48 8.7 32.85 6.98 
    Q 33.21 5.27 32.26 3.79 
    Q 31.3 2.32 29.58 1.96 
    L 29.58 1.96 Z" />

  <path fill="#b2699c" d="
    M 5 0 L 8 0 Q 8 1.24 7.12 2.12 Q 6.24 3 5 3 Q 3.76 3 2.88 2.12 Q 2 1.24 2 0 Q 2 -1.24 2.88 -2.12 Q 3.76 -3 5 -3 Q 6.24 -3 7.12 -2.12 Q 8 -1.24 8 0 
    M 12 0 L 16 0 Q 16 1.66 14.83 2.83 Q 13.66 4 12 4 Q 10.34 4 9.17 2.83 Q 8 1.66 8 0 Q 8 -1.66 9.17 -2.83 Q 10.34 -4 12 -4 Q 13.66 -4 14.83 -2.83 Q 16 -1.66 16 0 
    M 22 0 L 27 0 Q 27 2.07 25.54 3.54 Q 24.07 5 22 5 Q 19.93 5 18.46 3.54 Q 17 2.07 17 0 Q 17 -2.07 18.46 -3.54 Q 19.93 -5 22 -5 Q 24.07 -5 25.54 -3.54 Q 27 -2.07 27 0 
    M 1.55 4.76 L 4.55 4.76 Q 4.55 6 3.67 6.88 Q 2.79 7.76 1.55 7.76 Q 0.3 7.76 -0.58 6.88 Q -1.45 6 -1.45 4.76 Q -1.45 3.51 -0.58 2.63 Q 0.3 1.76 1.55 1.76 Q 2.79 1.76 3.67 2.63 Q 4.55 3.51 4.55 4.76 
    M 3.71 11.41 L 7.71 11.41 Q 7.71 13.07 6.54 14.24 Q 5.37 15.41 3.71 15.41 Q 2.05 15.41 0.88 14.24 Q -0.29 13.07 -0.29 11.41 Q -0.29 9.76 0.88 8.58 Q 2.05 7.41 3.71 7.41 Q 5.37 7.41 6.54 8.58 Q 7.71 9.76 7.71 11.41 
    M 6.8 20.92 L 11.8 20.92 Q 11.8 22.99 10.33 24.46 Q 8.87 25.92 6.8 25.92 Q 4.73 25.92 3.26 24.46 Q 1.8 22.99 1.8 20.92 Q 1.8 18.85 3.26 17.39 Q 4.73 15.92 6.8 15.92 Q 8.87 15.92 10.33 17.39 Q 11.8 18.85 11.8 20.92 
    M -4.05 2.94 L -1.05 2.94 Q -1.05 4.18 -1.92 5.06 Q -2.8 5.94 -4.05 5.94 Q -5.29 5.94 -6.17 5.06 Q -7.05 4.18 -7.05 2.94 Q -7.05 1.7 -6.17 0.82 Q -5.29 -0.06 -4.05 -0.06 Q -2.8 -0.06 -1.92 0.82 Q -1.05 1.7 -1.05 2.94 
    M -9.71 7.05 L -5.71 7.05 Q -5.71 8.71 -6.88 9.88 Q -8.05 11.05 -9.71 11.05 Q -11.37 11.05 -12.54 9.88 Q -13.71 8.71 -13.71 7.05 Q -13.71 5.4 -12.54 4.22 Q -11.37 3.05 -9.71 3.05 Q -8.05 3.05 -6.88 4.22 Q -5.71 5.4 -5.71 7.05 
    M -17.8 12.93 L -12.8 12.93 Q -12.8 15 -14.26 16.47 Q -15.73 17.93 -17.8 17.93 Q -19.87 17.93 -21.33 16.47 Q -22.8 15 -22.8 12.93 Q -22.8 10.86 -21.33 9.4 Q -19.87 7.93 -17.8 7.93 Q -15.73 7.93 -14.26 9.4 Q -12.8 10.86 -12.8 12.93 
    M -4.05 -2.94 L -1.05 -2.94 Q -1.05 -1.7 -1.92 -0.82 Q -2.8 0.06 -4.05 0.06 Q -5.29 0.06 -6.17 -0.82 Q -7.05 -1.7 -7.05 -2.94 Q -7.05 -4.18 -6.17 -5.06 Q -5.29 -5.94 -4.05 -5.94 Q -2.8 -5.94 -1.92 -5.06 Q -1.05 -4.18 -1.05 -2.94 
    M -9.71 -7.05 L -5.71 -7.05 Q -5.71 -5.4 -6.88 -4.22 Q -8.05 -3.05 -9.71 -3.05 Q -11.37 -3.05 -12.54 -4.22 Q -13.71 -5.4 -13.71 -7.05 Q -13.71 -8.71 -12.54 -9.88 Q -11.37 -11.05 -9.71 -11.05 Q -8.05 -11.05 -6.88 -9.88 Q -5.71 -8.71 -5.71 -7.05 
    M -17.8 -12.93 L -12.8 -12.93 Q -12.8 -10.86 -14.26 -9.4 Q -15.73 -7.93 -17.8 -7.93 Q -19.87 -7.93 -21.33 -9.4 Q -22.8 -10.86 -22.8 -12.93 Q -22.8 -15 -21.33 -16.47 Q -19.87 -17.93 -17.8 -17.93 Q -15.73 -17.93 -14.26 -16.47 Q -12.8 -15 -12.8 -12.93 
    M 1.55 -4.76 L 4.55 -4.76 Q 4.55 -3.51 3.67 -2.63 Q 2.79 -1.76 1.55 -1.76 Q 0.3 -1.76 -0.58 -2.63 Q -1.45 -3.51 -1.45 -4.76 Q -1.45 -6 -0.58 -6.88 Q 0.3 -7.76 1.55 -7.76 Q 2.79 -7.76 3.67 -6.88 Q 4.55 -6 4.55 -4.76 
    M 3.71 -11.41 L 7.71 -11.41 Q 7.71 -9.76 6.54 -8.58 Q 5.37 -7.41 3.71 -7.41 Q 2.05 -7.41 0.88 -8.58 Q -0.29 -9.76 -0.29 -11.41 Q -0.29 -13.07 0.88 -14.24 Q 2.05 -15.41 3.71 -15.41 Q 5.37 -15.41 6.54 -14.24 Q 7.71 -13.07 7.71 -11.41 
    M 6.8 -20.92 L 11.8 -20.92 Q 11.8 -18.85 10.33 -17.39 Q 8.87 -15.92 6.8 -15.92 Q 4.73 -15.92 3.26 -17.39 Q 1.8 -18.85 1.8 -20.92 Q 1.8 -22.99 3.26 -24.46 Q 4.73 -25.92 6.8 -25.92 Q 8.87 -25.92 10.33 -24.46 Q 11.8 -22.99 11.8 -20.92" />
</svg>`,
        isAdminPetal: false
    },
    javascript: {
        name: "JavaScript Petal",
        damage: 10,
        health: 128,
        size: 1.0,
        cooldown: 2000,
        description: "Obfuscated",
        color: "#000000",
        count: 1,
        image: `<svg width="32px" height="32px" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMinYMin meet"><path d="M0 0h256v256H0V0z" fill="#F7DF1E"/><path d="M67.312 213.932l19.59-11.856c3.78 6.701 7.218 12.371 15.465 12.371 7.905 0 12.89-3.092 12.89-15.12v-81.798h24.057v82.138c0 24.917-14.606 36.259-35.916 36.259-19.245 0-30.416-9.967-36.087-21.996M152.381 211.354l19.588-11.341c5.157 8.421 11.859 14.607 23.715 14.607 9.969 0 16.325-4.984 16.325-11.858 0-8.248-6.53-11.17-17.528-15.98l-6.013-2.58c-17.357-7.387-28.87-16.667-28.87-36.257 0-18.044 13.747-31.792 35.228-31.792 15.294 0 26.292 5.328 34.196 19.247L210.29 147.43c-4.125-7.389-8.591-10.31-15.465-10.31-7.046 0-11.514 4.468-11.514 10.31 0 7.217 4.468 10.14 14.778 14.608l6.014 2.577c20.45 8.765 31.963 17.7 31.963 37.804 0 21.654-17.012 33.51-39.867 33.51-22.339 0-36.774-10.654-43.819-24.574"/></svg>`,
        isAdminPetal: false
    },
    glitch: {
        name: "Glitch Petal",
        damage: -1,
        health: 128,
        size: 1.0,
        cooldown: 2000,
        description: "Glitch",
        color: "#000000",
        count: 1,
        image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 10 32 10" fill="none">
<image href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAHwAAAB8CAYAAACrHtS+AAAAAXNSR0IArs4c6QAAAFBlWElmTU0AKgAAAAgAAgESAAMAAAABAAEAAIdpAAQAAAABAAAAJgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAfKADAAQAAAABAAAAfAAAAACct/r/AAABWWlUWHRYTUw6Y29tLmFkb2JlLnhtcAAAAAAAPHg6eG1wbWV0YSB4bWxuczp4PSJhZG9iZTpuczptZXRhLyIgeDp4bXB0az0iWE1QIENvcmUgNi4wLjAiPgogICA8cmRmOlJERiB4bWxuczpyZGY9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkvMDIvMjItcmRmLXN5bnRheC1ucyMiPgogICAgICA8cmRmOkRlc2NyaXB0aW9uIHJkZjphYm91dD0iIgogICAgICAgICAgICB4bWxuczp0aWZmPSJodHRwOi8vbnMuYWRvYmUuY29tL3RpZmYvMS4wLyI+CiAgICAgICAgIDx0aWZmOk9yaWVudGF0aW9uPjE8L3RpZmY6T3JpZW50YXRpb24+CiAgICAgIDwvcmRmOkRlc2NyaXB0aW9uPgogICA8L3JkZjpSREY+CjwveDp4bXBtZXRhPgoZXuEHAAAHeElEQVR4Ae3dzW7jSAyFUXvg939lD6WsXPcUXBNgFiHYiwbM5v9twR9KivJ8PN7vx/InLY/Hc/HZfnymJ/OlW3USrTyeyFc9R/n3OxMqNCMrlepy4oxG2YrMXtDyVTjnQKjyvRErlZ5LiX+i4hhab2AEby1vDjeC505aW0bw1vLmcC/wCqFDcELYQULCExKCV1SiQC4HESc5GLEwob3HCkA/YdkMVlCuCz1dwRjkKb+fQgd/Z433UmOu8IM1dnIZwTupeTDLCH6wpE4uI3gnNQ9medEHdAIToYNwgiILS9wegp0nCieaXOGwHhZJ7KpsSAdTgRytOTGKnJ6WsURWEAPGIHOFY3GdTSN4Z3Ux2wiOpXQ2jeCd1cVsL3INHH2SlY66nanbnhlZltNmAEAwkeNU9xC7Huup1ZWLsaAs+TFYDQJcdSsUZWOlc4VrwY1tI3hjcTXaCK6tNLaN4I3F1WgvwYSeodLRk2JVhDZRFqjjDVpUqPBJkKVeNK9A03Uz42ldjFbJsFXeq826il2f9ZsrXHtrbBvBG4ur0UZwbaWxbQRvLK5Ge+kQR4wgwNDzV+AuhaoX4UqcFF2BBCqd0iGjAA1u/6FnoBy4S0ClItwfSnCB8Ft3NVc4N9fXOIL31ZaTjeBcS1/jCN5XW07GkzZDDIgAjmQnlNbzXGcVrhuD8AQowas6PnN8glwRickuEzyxGAEzf9oB6einvSxLmCt8I1lX8wjeVdnNXCP4ZjFdzSN4V2U3c12HZYEE4JUNh0RolVkoYVPYZuSDySVQV8dWKgygUlktgXCHVghoufp6bi4bVA3tAFIW230mnCs899vaMoK3ljeHG8FzJ60tI3hreXM4nrQJMN40ZsJTmECkQuVWqPMJIpdTWi7EklUpE9FW2LmjmC5jN+QVhRFZHauIPSMhDAuzPeYKx5I6m0bwzupithEcS+lsGsE7q4vZ6o0VeRyFg6d6jgwwIVOmQ1mbCFmogQMqoo5uIQp/TiFLaKj29EMbfDgPg/zfe54r3P/32lpH8LbSerAR3Htpax3B20rrwfieNoGN3pdm2CHGRHWy3VnoOaCdgmZ0VwYugcaIJnwqIfo7XIH40T0v3c0Vviyk+8cRvLvCy3wj+LKQ7h9H8O4KL/O9dDtOaELmWJL9fMxoggiP8zKhYDErZNy2F4CSTuQ8LyZBMxrN+TKYrwtJtw24qr/P4LnCd/9XmtpH8KbC7sYawXebaWofwZsKuxvr+pb//FaXYROtx9zsGiXqkA6Aka1Ud+nHUBTWaZ5eUyIC0m1KxeZk1Ui2XKY0KpY15Ih59WLj1W2u8HUjzT+P4M0FXscbwdeNNP88gjcXeB3v/AcRAFQCL/5aJ1KWSCTB5hhiMpSPkQnGMFrtKfvzbc91pWQ2ZLvisoZM4L2KxcBKt7jNFZ56tbaM4K3lzeFG8NxJa8sI3lreHO76Ss+v+rSQERy6UEIVIMgBOvTKChUWyMkvx706xnDZskJt00kga2QR/AxIgWb6cc+oqwbX28tzhWtLjW0jeGNxNdoIrq00to3gjcXVaC+BA3iquEEwgZS4Z6oTqhUm7kyoYT/UBSgh3WYOgByCDYsZy3nRsm6Zwm3Tc3pKobWXucJzb60tI3hreXO4ETx30toygreWN4e7OCSpA9/+x8+HZQ0UgNNtysJpMcOcnuYJSE/BFTxaXavDnO/4PXcZurFkXQHuqttc4Zt1djWP4F2V3cw1gm8W09U8gndVdjNXffOvX+tloTMgQY7pxmynofJDy6zhkyxmzHjMsZ5a3UG5vsy1sehWqNId3jG1bgtpzhW+EaOreQTvquxmrhF8s5iu5hG8q7KbueorHZgArgHDbO6YpqdvK6YfcRG9cBakU+jCMEx1G0FKyidS0omX/HxKl1XScnWYA6vuqu5c4XvJW/7LCN5S1v1QI/h+Ny3/ZQRvKet+qOubH0yQprRc2JDgoGxyU9kVMO62UcJ1s8O0XBmVMD0Jdwhlz3fjv/wLNdizCgM0V2CeK/yXuvzVsBH8ryr3y75H8F8u7q+GjeB/Vblf9l2v/EhgOYcEVBV0CDAQKp46bg/5dPtRB4usoWawKo3rl/XKMxPylSQgSPBZbUD5PhczV/jnPtp/GsHbS/w54Aj+uY/2n0bw9hJ/Dli/xgowAcji6dZnrvuTHupHhcKLtKYFBTYm9weIYXxWTouQ6EqWNcBYdSs5/djKaT4Hf7XOFf51Rb0cRvBeen6dZgT/uqJeDiN4Lz2/TlO/xiphAm+7qETpJ+AT7IDPmO6sgltRrPrTRrQD+SmfTrzUyxNLhan2ktGnLzE+AeG5wq1sW+sI3lZaDzaCey9trSN4W2k9WL0pIynBp1aZQLdWFWu/zGdLYmBiTeFUuhGA6IiEAirDnQpjEtTQbVSCl2IF0WhlzTdXOLTpbBrBO6uL2UZwLKWzaQTvrC5mu15vRiSAb5gMMeGmA6oCqiQMmCpZtpeRqHmb0jOzVXvJrdVexqKVOkRkRjSUfitQXUHMp1YyHWomzM4VzjX1NY7gfbXlZCM419LX+C+0g9bvfr+CNgAAAABJRU5ErkJggg==" height="32" width="32"/>
</svg>`,
        isAdminPetal: false
    },
    corn: {
        name: "Corn Petal",
        damage: 5,
        health: 100,
        size: 1.0,
        cooldown: 3500,
        description: "Corn",
        color: "#000000",
        count: 1,
        image: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <path d="M 8 29 
           Q -8 3 16 3 
           Q 40 3 24 29 
           Q 16 19 8 29 Z" 
        fill="#ffe419" 
        stroke="#cfb914" 
        stroke-width="2" 
        stroke-linejoin="round"
        stroke-linecap="round"/>
</svg>`,
        isAdminPetal: false
    },
    third_eye: {
        name: "Third Eye Petal",
        damage: 0,
        health: Infinity,
        size: 1.0,
        speed: 0.0,
        range: 0.0,
        cooldown: 1,
        fixedDirection: 0,
        visualOffsetY: -15,
        description: "Increases your petal range",
        color: "#000000",
        count: 0,
        equipFlags: EquipmentFlags.ThirdEye,
        noPhysics: true,
        image: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <path id="eyeShape"
          d="M 16 1
             Q 28 16 16 31
             Q 4 16 16 1 Z" />
  </defs>

  <use href="#eyeShape" fill="#111111" />

  <circle cx="16" cy="16" r="7.5" fill="#eeeeee" />

  <use href="#eyeShape"
       fill="none"
       stroke="#111111"
       stroke-width="2.25"
       stroke-linecap="round"
       stroke-linejoin="round" />
</svg>`,
        isAdminPetal: false,
        playerModifiers: { range: 1.15 }
    },
    faster: {
        name: "Faster",
        damage: 5,
        health: 5,
        size: 0.5,
        cooldown: 500,
        description: "Makes your petals move faster",
        color: "#000000",
        count: 1,
        image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="14" fill="white" stroke-width="4" stroke="#faffc9"/>
</svg>`,
        isAdminPetal: false,
        playerModifiers: { rotationSpeed: 1.1 }
    },
    pollen: {
        name: "Pollen Petal",
        damage: 10,
        health: 10,
        size: 1.0,
        cooldown: 1000,
        // todo: make it drop on ground
        description: "A petal that releases pollen",
        color: "#000000",
        count: 1,
        image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="14" fill="#ffe763" stroke-width="4" stroke="#cfbb50"/>
</svg>`,
        isAdminPetal: false
    },
    sparkle: {
        name: "Sparkle Petal",
        damage: 9999999999,
        health: 99999,
        size: 1.0,
        cooldown: 500,
        description: "A petal that shines brightly",
        color: "#FFD700",
        count: 1,
        image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="10" cy="10" r="3" fill="#ff0000"/>
<circle cx="5" cy="20" r="3" fill="#ffff00"/>
<circle cx="20" cy="27" r="3" fill="#00ffff"/>
<circle cx="27" cy="3" r="3" fill="#00ff00"/>
<circle cx="27" cy="15" r="3" fill="#ff00ff"/>
</svg>`,
        isAdminPetal: true
    },
    healing: {// test petal
        name: "Healing Petal",
        damage: 5,
        health: 15,
        size: 1.2,
        cooldown: 2000,
        description: "A petal that heals the player when spawned",
        color: "#FF69B4",
        count: 1,
        actions: "heal 20; delay 2000; restart;",
        image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="14" fill="#ff94f4" stroke="#d17bc9" stroke-width="4"/>
<path d="M16 8 L16 24 M8 16 L24 16" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>
</svg>`,
        isAdminPetal: true
    },
    explosive: {// test petal
        name: "Explosive Petal",
        damage: 25,
        health: 5,
        size: 1.0,
        cooldown: 3000,
        description: "A petal that explodes when it hits an enemy",
        color: "#FF4500",
        count: 1,
        actions: "wait_until_collision; explode 30; break;",
        image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="14" fill="#ff6b35" stroke="#d63031" stroke-width="4"/>
<path d="M12 12 L20 20 M20 12 L12 20" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>
</svg>`,
        isAdminPetal: true
    },
    test_explosive: {// test petal for immediate explosion
        name: "Test Explosive Petal",
        damage: 15,
        health: 10,
        size: 1.0,
        cooldown: 2000,
        description: "A test petal that explodes immediately",
        color: "#FF0000",
        count: 1,
        actions: "explode 50; delay 3000; restart;",
        image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="14" fill="#ff0000" stroke="#cc0000" stroke-width="4"/>
<path d="M8 8 L24 24 M24 8 L8 24" stroke="#ffffff" stroke-width="3" stroke-linecap="round"/>
</svg>`,
        isAdminPetal: true
    },
    shield: {
        name: "Shield Petal",
        damage: 10,
        health: 20,
        size: 1.1,
        cooldown: 5000,
        description: "A petal that provides shield when spawned",
        color: "#4169E1",
        count: 1,
        actions: "shield 50 10000; delay 10000; restart;",
        image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="14" fill="#6495ed" stroke="#4169e1" stroke-width="4"/>
<path d="M16 6 L20 12 L16 18 L12 12 Z" stroke="#ffffff" stroke-width="2" stroke-linecap="round" fill="none"/>
</svg>`,
        isAdminPetal: true
    },
    splitter: {
        name: "Splitter Petal",
        damage: 5,
        health: 15,
        size: 1.0,
        cooldown: 10000,
        description: "Allows you to have two players at once",
        color: "#9B59B6",
        count: 1,
        image: `<svg width="32" height="32" viewBox="-30 -30 60 60" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="eye-clip">
      <ellipse cx="-7" cy="-4.8" rx="3.2" ry="6.5" />
      <ellipse cx="7" cy="-4.8" rx="3.2" ry="6.5" />
    </clipPath>
    <clipPath id="split-clip">
      <path d="M 0 -30 L -10 -10 L 4 10 L 0 30 L -30 30L -30 -30"/>
    </clipPath>
  </defs>

  <g clip-path="url(#split-clip)">

  <circle cx="0" cy="0" r="26.5" fill="#CFBB50" />

  <circle cx="0" cy="0" r="23.5" fill="#FFE763" />

  <path d="M -6 10 Q 0 14.5 6 10" fill="none" stroke="#000" stroke-width="1.7" stroke-linecap="round" />

  <ellipse cx="-7" cy="-4.8" rx="3.2" ry="6.5" fill="#000" />
  <ellipse cx="7" cy="-4.8" rx="3.2" ry="6.5" fill="#000" />

  <g clip-path="url(#eye-clip)">
    <circle cx="-5.2" cy="-4.8" r="3" fill="#fff" />
    <circle cx="8.8" cy="-4.8" r="3" fill="#fff" />
  </g>

  <ellipse cx="-7" cy="-4.8" rx="3.2" ry="6.5" fill="none" stroke="#000" stroke-width="1" />
  <ellipse cx="7" cy="-4.8" rx="3.2" ry="6.5" fill="none" stroke="#000" stroke-width="1" />
  </g>
</svg>`,
        isAdminPetal: false
    },
    hornet_missile: {
        name: "Hornet Missile",
        damage: 10,
        health: 10,
        size: 1.0,
        cooldown: 2000,
        description: "A missile that deals damage to the target",
        color: "#000000",
        count: 1,
        image: `<svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
  <!-- 
    The triangle is drawn and then rotated 90 degrees clockwise around its center point (16, 16).
    The original points were (0,32), (28,32), (14,0).
    After rotation and centering within a 32x32 canvas, the points are adjusted to fit the new dimensions.
  -->
  <polygon 
    points="32,32 32,4 0,18"
    fill="#000000" 
    transform="rotate(180 16 16) translate(0, -2)" />
</svg>
`,
        isAdminPetal: true
    },
    action_test: {
        name: "Action Test Petal",
        damage: 10,
        health: 10,
        size: 1.0,
        cooldown: 1000,
        description: "A petal that tests actions",
        color: "#000000",
        count: 1,
        actions: test_petal_action,
        image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle cx="16" cy="16" r="14" fill="#000000" stroke="#000000" stroke-width="4"/>
<path d="M8 8 L24 24 M24 8 L8 24" stroke="#ffffff" stroke-width="3" stroke-linecap="round"/>
</svg>`,
        isAdminPetal: true
    },
    egg: {
        name: "Egg Petal",
        damage: 5,
        health: 5,
        size: 1.0,
        cooldown: 1000,
        description: "Spawns a pet mob that fights alongside you",
        color: "#FFD700",
        count: 1,
        petMobType: "bee",
        petMobRarity: "common",
        image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<ellipse cx="16" cy="16" rx="12" ry="14" fill="#FFD700" stroke="#FFA500" stroke-width="2"/>
<ellipse cx="16" cy="14" rx="8" ry="10" fill="#FFF8DC"/>
</svg>`,
        isAdminPetal: true
    },
    glass: {
        name: "Glass Petal",
        damage: 12,
        health: Infinity,
        size: 1.0,
        cooldown: 1000,
        description: "Fragile-looking but unbreakable. Hits hard but needs time between strikes",
        color: "#B0E0E6",
        knockback: 0,
        count: 1,
        damageCooldown: 1000,
        image: `<svg width="20" height="20" viewBox="-10 -10 20 20" xmlns="http://www.w3.org/2000/svg">
  <path
    d="M 7 0 L 3.5 6.062 L -3.5 6.062 L -7 0 L -3.5 -6.062 L 3.5 -6.062 Z"
    fill="rgba(255, 255, 255, 0.25)"
    stroke="rgba(255, 255, 255, 0.75)"
    stroke-width="3"
    stroke-linecap="round"
    stroke-linejoin="round"
  />
</svg>`
    },
};

// Helper function to darken a hex color for egg stroke
function darkenColor(hex: string, factor: number = 0.7): string {
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
function generateEggSVG(mobColor: string): string {
    const strokeColor = darkenColor(mobColor, 0.7);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<circle r="13" cx="16" cy="16" fill="${mobColor}" stroke="${strokeColor}" stroke-width="4"/>
</svg>`;
}

// Auto-generate eggs for all mobs that don't have them
for (const mobType in BASE_MOB_CONFIGS) {
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
    const mobConfig = BASE_MOB_CONFIGS[mobType];
    if (!mobConfig) {
        continue;
    }
    
    // Determine pet mob type (check if there's a _pet version, otherwise use the mob type itself)
    const petMobType = BASE_MOB_CONFIGS[`${mobType}_pet`] ? `${mobType}_pet` : mobType;
    
    // Create the egg config
    BASE_PETAL_CONFIGS[eggName] = {
        name: `${mobConfig.name} Egg Petal`,
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
const RARITY_COLORS: { [key in Rarity]: string } = {
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
const LIGHTNING_SCALING_TABLE: { [key in Rarity]: { multiplier: number, damageAt10Base: number, damageAt25Base: number, damageAt50Base: number } } = {
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
export function getLightningDamage(baseDamage: number, rarity: Rarity): number {
    const scaling = LIGHTNING_SCALING_TABLE[rarity];
    return baseDamage * scaling.multiplier;
}

// Helper function to get lightning scaling info for a rarity
export function getLightningScalingInfo(rarity: Rarity): { multiplier: number, damageAt10Base: number, damageAt25Base: number, damageAt50Base: number } {
    return LIGHTNING_SCALING_TABLE[rarity];
}

// Example usage:
// const epicLightningDamage = getLightningDamage(25, 'epic'); // Returns 675 (25 × 27)
// const scalingInfo = getLightningScalingInfo('legendary'); // Returns multiplier: 81, damageAt10Base: 810, etc.

// Function to find SVG fallback for higher rarities
function findSvgFallback(petalType: string, rarity: Rarity): string | undefined {
    const rarityIndex = RARITY_LEVELS.indexOf(rarity);
    
    // Try to find SVG from lower rarities
    for (let i = rarityIndex - 1; i >= 0; i--) {
        const lowerRarity = RARITY_LEVELS[i];
        const petalConfig = PETAL_CONFIG[petalType]?.[lowerRarity];
        if (petalConfig?.image) {
            return petalConfig.image;
        }
    }
    
    // Fallback to base config SVG
    return BASE_PETAL_CONFIGS[petalType]?.image;
}

// Function to generate petal stats for a specific rarity
function generatePetalStats(baseConfig: BasePetalConfig, rarity: Rarity, petalType: string): PetalStats {
    const rarityIndex = RARITY_LEVELS.indexOf(rarity);
    const multiplier = Math.pow(3, rarityIndex); // 3x multiplier for each rarity level
    
    const prefix = RARITY_PREFIXES[rarity];
    const name = prefix ? `${prefix} ${baseConfig.name}` : baseConfig.name;
    
    // Get rarity-specific overrides
    const overrides = RARITY_OVERRIDES[petalType]?.[rarity] || {};
    
    // Special handling for yggdrasil - always 1 damage and 1 health
    let damage = baseConfig.damage * multiplier;
    let health = baseConfig.health * multiplier;
    let poison = baseConfig.poison ? baseConfig.poison * multiplier : undefined; // Scale poison with rarity
    // Scale passiveHeal with sqrt(3) per rarity level (same as heal action)
    let passiveHeal = baseConfig.passiveHeal ? baseConfig.passiveHeal * Math.pow(Math.sqrt(3), rarityIndex) : undefined;
    let cooldown = baseConfig.cooldown;
    
    if (petalType === 'yggdrasil') {
        damage = 1;
        health = 1;
        cooldown = overrides.cooldown ?? baseConfig.cooldown;
    } else {
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
    let playerModifiers: PlayerModifiers | undefined = undefined;
    if (baseConfig.playerModifiers || overrides.playerModifiers) {
        const baseModifiers = baseConfig.playerModifiers || {};
        const overrideModifiers = overrides.playerModifiers || {};
        
        // Calculate rarity scaling multiplier for player modifiers
        // common (0): 1.0x, unique (8): 4.0x
        const modifierRarityMultiplier = 1 + (rarityIndex / 8) * 3;
        
        // For modifiers, we can either:
        // 1. Use override if provided (for rarity-specific scaling) - overrides are NOT scaled
        // 2. Scale base modifiers by rarity multiplier
        if (overrideModifiers.damage !== undefined || overrideModifiers.maxHealth !== undefined || overrideModifiers.speed !== undefined || overrideModifiers.range !== undefined || overrideModifiers.rotationSpeed !== undefined) {
            // Use override modifiers directly (not scaled, as they're already rarity-specific)
            playerModifiers = {
                damage: overrideModifiers.damage ?? baseModifiers.damage,
                maxHealth: overrideModifiers.maxHealth ?? baseModifiers.maxHealth,
                speed: overrideModifiers.speed ?? baseModifiers.speed,
                range: overrideModifiers.range ?? baseModifiers.range,
                rotationSpeed: overrideModifiers.rotationSpeed ?? baseModifiers.rotationSpeed
            };
        } else if (baseModifiers.damage !== undefined || baseModifiers.maxHealth !== undefined || baseModifiers.speed !== undefined || baseModifiers.range !== undefined || baseModifiers.rotationSpeed !== undefined) {
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
                    : undefined
            };
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
        actions: overrides.actions ?? baseConfig.actions,
        passiveHeal: passiveHeal, // Scaled passive healing per second
        isAdminPetal: baseConfig.isAdminPetal ?? false,
        range: baseConfig.range ?? 1.0, // Default range multiplier
        projectile: baseConfig.projectile, // Include projectile config if present
        playerModifiers: playerModifiers, // Include player modifiers if present
        petMobType: baseConfig.petMobType, // Include pet mob type if present
        petMobRarity: baseConfig.petMobRarity, // Include pet mob rarity if present
        fixedDirection: overrides.fixedDirection ?? baseConfig.fixedDirection,
        visualOffsetX: overrides.visualOffsetX ?? baseConfig.visualOffsetX,
        visualOffsetY: overrides.visualOffsetY ?? baseConfig.visualOffsetY,
        damageCooldown: overrides.damageCooldown ?? baseConfig.damageCooldown,
        faceFlags: baseConfig.faceFlags,
        equipFlags: baseConfig.equipFlags,
        noPhysics: baseConfig.noPhysics,
        clumped: overrides.clumped ?? baseConfig.clumped,
        emissive: overrides.emissive ?? baseConfig.emissive,
        lightRadius: overrides.lightRadius ?? baseConfig.lightRadius,
        lightColor: overrides.lightColor ?? baseConfig.lightColor,
    };
}

// Generate the full petal configuration
export const PETAL_CONFIG: PetalConfig = {};

// Initialize the petal configuration
for (const petalType in BASE_PETAL_CONFIGS) {
    PETAL_CONFIG[petalType] = {};
    for (const rarity of RARITY_LEVELS) {
        PETAL_CONFIG[petalType][rarity] = generatePetalStats(BASE_PETAL_CONFIGS[petalType], rarity, petalType);
    }
}

// Register all petal types for compact inventory encoding
import { initInventoryCodec } from './inventoryCodec';
initInventoryCodec(RARITY_LEVELS, Object.keys(PETAL_CONFIG));

export function getPetalStats(petalType: string, rarity: string): PetalStats | null {
    return PETAL_CONFIG[petalType]?.[rarity] || null;
}

export function getAllPetalTypes(): string[] {
    return Object.keys(PETAL_CONFIG);
}

export function getPetalRarities(petalType: string): string[] {
    return Object.keys(PETAL_CONFIG[petalType] || {});
}

// Action parser function
export function parsePetalActions(actionString: string): PetalAction[] {
    if (!actionString || typeof actionString !== 'string') {
        return [];
    }

    const actions: PetalAction[] = [];
    const actionParts = actionString.split(';').map(part => part.trim()).filter(part => part.length > 0);

    for (const part of actionParts) {
        const [actionType, ...params] = part.split(' ').map(p => p.trim());
        
        switch (actionType.toLowerCase()) {
            case 'heal':
                const healValue = params.length > 0 ? parseFloat(params[0]) : 10;
                actions.push({ type: 'heal', value: healValue });
                break;
            case 'break':
                actions.push({ type: 'break' });
                break;
            case 'damage_boost':
                const damageValue = params.length > 0 ? parseFloat(params[0]) : 1.5;
                const damageDuration = params.length > 1 ? parseFloat(params[1]) * 1000 : 5000; // Convert seconds to ms
                actions.push({ type: 'damage_boost', value: damageValue, duration: damageDuration });
                break;
            case 'speed_boost':
                const speedValue = params.length > 0 ? parseFloat(params[0]) : 1.5;
                const speedDuration = params.length > 1 ? parseFloat(params[1]) * 1000 : 5000; // Convert seconds to ms
                actions.push({ type: 'speed_boost', value: speedValue, duration: speedDuration });
                break;
            case 'shield':
                const shieldValue = params.length > 0 ? parseFloat(params[0]) : 50;
                const shieldDuration = params.length > 1 ? parseFloat(params[1]) * 1000 : 3000; // Convert seconds to ms
                actions.push({ type: 'shield', value: shieldValue, duration: shieldDuration });
                break;
            case 'explode':
                const explodeValue = params.length > 0 ? parseFloat(params[0]) : 30;
                actions.push({ type: 'explode', value: explodeValue });
                break;
            case 'lightning':
                const lightningValue = params.length > 0 ? parseFloat(params[0]) : 100;
                actions.push({ type: 'lightning', value: lightningValue });
                break;
            case 'delay':
                const delayValue = params.length > 0 ? parseFloat(params[0]) : 1000;
                actions.push({ type: 'delay', value: delayValue });
                break;
            case 'restart':
                actions.push({ type: 'restart' });
                break;
            case 'wait_until_collision':
                actions.push({ type: 'wait_until_collision' });
                break;
            case 'if':
                const condition = params.join(' ');
                actions.push({ type: 'if', condition: condition });
                break;
            case 'else':
                actions.push({ type: 'else' });
                break;
            case 'endif':
                actions.push({ type: 'endif' });
                break;
            case 'loop':
                const loopCount = params.length > 0 ? parseFloat(params[0]) : -1; // -1 means infinite
                actions.push({ type: 'loop', value: loopCount });
                break;
            case 'endloop':
                actions.push({ type: 'endloop' });
                break;
            case 'goto':
                const labelName = params[0] || '';
                actions.push({ type: 'goto', stringValue: labelName });
                break;
            case 'label':
                const label = params[0] || '';
                actions.push({ type: 'label', stringValue: label });
                break;
            case 'set_memory':
                const memKey = params[0] || '';
                const memValueParam = params.length > 1 ? params[1] : '0';
                const memValue = parseFloat(memValueParam);
                // If value is a memory reference, store it in a special format
                if (memValueParam.startsWith('memory:')) {
                    // Store as stringValue with special prefix to indicate it's a memory reference value
                    actions.push({ type: 'set_memory', stringValue: memKey, value: NaN, condition: memValueParam });
                } else if (!isNaN(memValue)) {
                    actions.push({ type: 'set_memory', stringValue: memKey, value: memValue });
                } else {
                    actions.push({ type: 'set_memory', stringValue: memKey, value: 0 });
                }
                break;
            case 'get_memory':
                const getMemKey = params[0] || '';
                actions.push({ type: 'get_memory', stringValue: getMemKey });
                break;
            case 'add_memory':
                const addMemKey = params[0] || '';
                const addMemValue = params.length > 1 ? parseFloat(params[1]) : 0;
                actions.push({ type: 'add_memory', stringValue: addMemKey, value: addMemValue });
                break;
            case 'multiply_memory':
                const multMemKey = params[0] || '';
                const multMemValue = params.length > 1 ? parseFloat(params[1]) : 1;
                actions.push({ type: 'multiply_memory', stringValue: multMemKey, value: multMemValue });
                break;
            case 'set_petal_damage':
                const petalDmg = params.length > 0 ? parseFloat(params[0]) : 0;
                actions.push({ type: 'set_petal_damage', value: petalDmg });
                break;
            case 'set_petal_health':
                const petalHp = params.length > 0 ? parseFloat(params[0]) : 0;
                actions.push({ type: 'set_petal_health', value: petalHp });
                break;
            case 'set_petal_size':
                const petalSzParam = params.length > 0 ? params[0] : '1';
                const petalSz = parseFloat(petalSzParam);
                // If it's a memory reference, store in stringValue instead
                if (petalSzParam.startsWith('memory:')) {
                    actions.push({ type: 'set_petal_size', stringValue: petalSzParam });
                } else if (!isNaN(petalSz)) {
                    actions.push({ type: 'set_petal_size', value: petalSz });
                } else {
                    actions.push({ type: 'set_petal_size', value: 1 }); // Default
                }
                break;
            case 'add_petal_damage':
                const addPetalDmg = params.length > 0 ? parseFloat(params[0]) : 0;
                actions.push({ type: 'add_petal_damage', value: addPetalDmg });
                break;
            case 'add_petal_health':
                const addPetalHp = params.length > 0 ? parseFloat(params[0]) : 0;
                actions.push({ type: 'add_petal_health', value: addPetalHp });
                break;
            case 'add_petal_size':
                const addPetalSz = params.length > 0 ? parseFloat(params[0]) : 0;
                actions.push({ type: 'add_petal_size', value: addPetalSz });
                break;
            case 'set_player_damage':
                const playerDmg = params.length > 0 ? parseFloat(params[0]) : 0;
                actions.push({ type: 'set_player_damage', value: playerDmg });
                break;
            case 'set_player_max_health':
                const playerHp = params.length > 0 ? parseFloat(params[0]) : 0;
                actions.push({ type: 'set_player_max_health', value: playerHp });
                break;
            case 'set_player_speed':
                const playerSpd = params.length > 0 ? parseFloat(params[0]) : 1;
                actions.push({ type: 'set_player_speed', value: playerSpd });
                break;
            case 'add_player_damage':
                const addPlayerDmg = params.length > 0 ? parseFloat(params[0]) : 0;
                actions.push({ type: 'add_player_damage', value: addPlayerDmg });
                break;
            case 'add_player_max_health':
                const addPlayerHp = params.length > 0 ? parseFloat(params[0]) : 0;
                actions.push({ type: 'add_player_max_health', value: addPlayerHp });
                break;
            case 'add_player_speed':
                const addPlayerSpd = params.length > 0 ? parseFloat(params[0]) : 0;
                actions.push({ type: 'add_player_speed', value: addPlayerSpd });
                break;
            case 'compare':
            case 'compare_gt':
            case 'compare_lt':
            case 'compare_gte':
            case 'compare_lte':
            case 'compare_eq':
            case 'compare_neq':
                const compareType = actionType.replace('compare_', '') as 'gt' | 'lt' | 'gte' | 'lte' | 'eq' | 'neq';
                const compareLeft = params[0] || '';
                const compareRight = params.length > 1 ? parseFloat(params[1]) : 0;
                actions.push({ type: actionType as any, stringValue: compareLeft, value: compareRight, comparisonType: compareType });
                break;
            case 'split_player':
                actions.push({ type: 'split_player' });
                break;
            case 'switch_player':
                actions.push({ type: 'switch_player' });
                break;
            default:
                console.warn(`Unknown petal action type: ${actionType}`);
        }
    }

    return actions;
}
