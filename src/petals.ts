export interface PetalStats {
    name: string;
    damage: number;
    health: number;
    size: number;
    speed?: number; // Rotation speed multiplier (default 1.0)
    cooldown: number; // Cooldown time in milliseconds
    knockback?: number; // Knockback force applied to enemies (default 1)
    description: string;
    color: string;
    image?: string; // 32x32 SVG image (optional)
    count: number; // Number of petals to spawn per equipped item (default 1)
    actions?: string; // Action sequence string like "heal 20; break;" (optional)
    isAdminPetal?: boolean; // Whether the petal is an admin petal (default false)
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
    'unique'
] as const;

export type Rarity = typeof RARITY_LEVELS[number];

// Petal action types
export interface PetalAction {
    type: 'heal' | 'break' | 'damage_boost' | 'speed_boost' | 'shield' | 'explode' | 'delay' | 'restart' | 'wait_until_collision';
    value?: number; // Optional numeric parameter for the action
    duration?: number; // Optional duration for temporary effects (in milliseconds)
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
    actions?: string; // Action sequence string like "heal 20; break;"
    isAdminPetal?: boolean; // Whether the petal is an admin petal (default false)
}

// Special rarity overrides for specific petals
interface RarityOverride {
    count?: number;
    image?: string;
    description?: string;
    cooldown?: number;
    damage?: number;
    health?: number;
    actions?: string; // Action sequence string like "heal 20; break;"
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
    }
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
            description: "A thorny petal that deals extra damage",
            color: "#FF69B4",
        count: 1,
            actions: "delay 1500; heal 100; break;",
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
            health: 3,
            size: 0.8,
            cooldown: 800,
            description: "A sand petal that provides basic protection",
            color: "#8B0000",
            count: 4,
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
        description: "A yggdrasil petal that can revive flowers",
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
};

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
    unique: "#bf00ff"
};

// Rarity name prefixes
const RARITY_PREFIXES: { [key in Rarity]: string } = {
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
    let cooldown = baseConfig.cooldown;
    
    if (petalType === 'yggdrasil') {
        damage = 1;
        health = 1;
        cooldown = overrides.cooldown ?? baseConfig.cooldown;
    } else {
        // Apply overrides for other petals
        damage = overrides.damage ?? damage;
        health = overrides.health ?? health;
        cooldown = overrides.cooldown ?? cooldown;
    }
    
    return {
        name,
        damage,
        health,
        size: baseConfig.size, // Size stays the same for each petal type
        speed: baseConfig.speed ?? 1.0, // Default speed
        cooldown,
        knockback: baseConfig.knockback ?? 5, // Default knockback
        description: overrides.description ?? baseConfig.description,
        color: RARITY_COLORS[rarity],
        image: overrides.image ?? baseConfig.image ?? findSvgFallback(petalType, rarity),
        count: overrides.count ?? baseConfig.count,
        actions: overrides.actions ?? baseConfig.actions,
        isAdminPetal: baseConfig.isAdminPetal ?? false
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
            default:
                console.warn(`Unknown petal action type: ${actionType}`);
        }
    }

    return actions;
}
