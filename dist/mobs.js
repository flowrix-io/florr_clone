"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MOB_DROP_TABLES = exports.MOB_CONFIG = void 0;
exports.getMobStats = getMobStats;
exports.getAllMobTypes = getAllMobTypes;
exports.getMobRarities = getMobRarities;
exports.calculateMobDrops = calculateMobDrops;
exports.getMobDropTable = getMobDropTable;
exports.testDropSystem = testDropSystem;
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
    uncommon: 3,
    rare: 9,
    epic: 27,
    legendary: 81,
    mythic: 243,
    ultra: 729,
    super: 2187,
    unique: 6561
};
// XP scaling: Base value of 10, multiplied by 3 for each rarity level
const XP_SCALING = {
    common: 10,
    uncommon: 30,
    rare: 90,
    epic: 270,
    legendary: 810,
    mythic: 2430,
    ultra: 7290,
    super: 21870,
    unique: 65610
};
// Base stats for each mob type (common values)
const BASE_STATS = {
    bee: { damage: 50, health: 37.5 },
    ladybug: { damage: 10, health: 62.5 },
    soldier_ant: { damage: 10, health: 100 }
};
exports.MOB_CONFIG = {
    bee: {
        common: {
            name: "Common Bee",
            damage: 50,
            health: 37.5,
            size: 1.0,
            speed: 0.5,
            cooldown: 2000, // 2 seconds
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
            range: 100,
            xp: 1
        },
        uncommon: {
            name: "Uncommon Bee",
            damage: 150,
            health: 140.625,
            size: 1.2,
            speed: 0.5,
            cooldown: 2000, // 2 seconds
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
            range: 100,
            xp: 3
        },
        rare: {
            name: "Rare Bee",
            damage: 450,
            health: 506.25,
            size: 1.6,
            speed: 0.5,
            cooldown: 2000, // 2 seconds
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
            range: 100,
            xp: 30
        },
        epic: {
            name: "Epic Bee",
            damage: 1350,
            health: 2025,
            size: 2.56,
            speed: 0.5,
            cooldown: 2000, // 2 seconds
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
            range: 100,
            xp: 270
        },
        legendary: {
            name: "Legendary Bee",
            damage: 4050,
            health: 15187.5,
            size: 4.096,
            speed: 0.5,
            cooldown: 2000, // 2 seconds
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
            range: 100,
            xp: 1400
        },
        mythic: {
            name: "Mythic Bee",
            damage: 12150,
            health: 91125,
            size: 6.5536,
            speed: 0.5,
            cooldown: 2000, // 2 seconds
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
            range: 100,
            xp: 32000
        },
        ultra: {
            name: "Ultra Bee",
            damage: 36450,
            health: 1093500,
            size: 10.48576,
            speed: 0.5,
            cooldown: 2000, // 2 seconds
            description: "An ultra bee with cosmic power",
            color: "#de1f65",
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
            range: 100,
            xp: 150000
        },
        super: {
            name: "Super Bee",
            damage: 109350,
            health: 49207500,
            size: 16.777216,
            speed: 0.5,
            cooldown: 2000, // 2 seconds
            description: "A super bee with divine energy",
            color: "#2bffa4",
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
            range: 100,
            xp: 1200000
        },
        unique: {
            name: "Unique Bee",
            damage: 328050,
            health: 737611250,
            size: 26.8435456,
            speed: 0.5,
            cooldown: 2000, // 2 seconds
            description: "A unique bee of ultimate power",
            color: "#bf00ff",
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
            range: 100,
            xp: 6800000
        }
    },
    ladybug: {
        common: {
            name: "Common Ladybug",
            damage: 10,
            health: 62.5,
            size: 1.0,
            speed: 0.5,
            cooldown: 2000, // 2 seconds
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
            range: 100,
            xp: 1
        },
        uncommon: {
            name: "Uncommon Ladybug",
            damage: 30,
            health: 234.375,
            size: 1.2,
            speed: 0.5,
            cooldown: 2000, // 2 seconds
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
            range: 100,
            xp: 3
        },
        rare: {
            name: "Rare Ladybug",
            damage: 90,
            health: 843.75,
            size: 1.6,
            speed: 0.5,
            cooldown: 2000, // 2 seconds
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
            range: 100,
            xp: 30
        },
        epic: {
            name: "Epic Ladybug",
            damage: 270,
            health: 3375,
            size: 2.56,
            speed: 0.5,
            cooldown: 2000, // 2 seconds
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
            range: 100,
            xp: 270
        },
        legendary: {
            name: "Legendary Ladybug",
            damage: 810,
            health: 25312.5,
            size: 4.096,
            speed: 0.5,
            cooldown: 2000, // 2 seconds
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
            range: 100,
            xp: 1400
        },
        mythic: {
            name: "Mythic Ladybug",
            damage: 2430,
            health: 151875,
            size: 6.5536,
            speed: 0.5,
            cooldown: 2000, // 2 seconds
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
            range: 100,
            xp: 32000
        },
        ultra: {
            name: "Ultra Ladybug",
            damage: 7290,
            health: 1822500,
            size: 10.48576,
            speed: 0.5,
            cooldown: 2000, // 2 seconds
            description: "An ultra ladybug with cosmic power",
            color: "#de1f65",
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
            range: 100,
            xp: 150000
        },
        super: {
            name: "Super Ladybug",
            damage: 21870,
            health: 82012500,
            size: 16.777216,
            speed: 0.5,
            cooldown: 2000, // 2 seconds
            description: "A super ladybug with divine energy",
            color: "#2bffa4",
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
            range: 100,
            xp: 1200000
        },
        unique: {
            name: "Unique Ladybug",
            damage: 65610,
            health: 1230187500,
            size: 26.8435456,
            speed: 0.5,
            cooldown: 2000, // 2 seconds
            description: "A unique ladybug of ultimate power",
            color: "#bf00ff",
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
            range: 100,
            xp: 6800000
        }
    },
    soldier_ant: {
        common: {
            name: "Common Soldier Ant",
            damage: 10,
            health: 100,
            size: 1.0,
            speed: 1.0,
            cooldown: 2000, // 2 seconds
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
            range: 100,
            xp: 1
        },
        uncommon: {
            name: "Uncommon Soldier Ant",
            damage: 30,
            health: 375,
            size: 1.2,
            speed: 1.0,
            cooldown: 2000, // 2 seconds
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
            range: 200,
            xp: 3
        },
        rare: {
            name: "Rare Soldier Ant",
            damage: 90,
            health: 1350,
            size: 1.6,
            speed: 1.0,
            cooldown: 2000, // 2 seconds
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
            range: 350,
            xp: 30
        },
        epic: {
            name: "Epic Soldier Ant",
            damage: 270,
            health: 5400,
            size: 2.56,
            speed: 1.0,
            cooldown: 2000, // 2 seconds
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
            range: 500,
            xp: 270
        },
        legendary: {
            name: "Legendary Soldier Ant",
            damage: 810,
            health: 40500,
            size: 4.096,
            speed: 1.0,
            cooldown: 2000, // 2 seconds
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
            range: 600,
            xp: 1400
        },
        mythic: {
            name: "Mythic Soldier Ant",
            damage: 2430,
            health: 243000,
            size: 6.5536,
            speed: 1.0,
            cooldown: 2000, // 2 seconds
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
            range: 750,
            xp: 32000
        },
        ultra: {
            name: "Ultra Soldier Ant",
            damage: 7290,
            health: 2916000,
            size: 10.48576,
            speed: 1.0,
            cooldown: 2000, // 2 seconds
            description: "An ultra soldier ant with cosmic power",
            color: "#de1f65",
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
            range: 750,
            xp: 150000
        },
        super: {
            name: "Super Soldier Ant",
            damage: 21870,
            health: 131220000,
            size: 16.777216,
            speed: 1.0,
            cooldown: 2000, // 2 seconds
            description: "A super soldier ant with divine energy",
            color: "#2bffa4",
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
            range: 750,
            xp: 1200000
        },
        unique: {
            name: "Unique Soldier Ant",
            damage: 65610,
            health: 1968300000,
            size: 26.8435456,
            speed: 1.0,
            cooldown: 2000, // 2 seconds
            description: "A unique soldier ant of ultimate power",
            color: "#bf00ff",
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
            range: 750,
            xp: 6800000
        }
    }
};
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
