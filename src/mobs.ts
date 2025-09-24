export interface MobStats {
    name: string;
    damage: number;
    health: number;
    size: number;
    speed: number; // Movement speed
    cooldown: number; // Attack cooldown time in milliseconds
    description: string;
    color: string;
    image: string; // 32x32 SVG image
    is_hostile: boolean; // Whether the mob attacks players
    range: number; // Detection/attack range
}

export interface MobConfig {
    [mobType: string]: {
        [rarity: string]: MobStats;
    };
}

export const MOB_CONFIG: MobConfig = {
    bee: {
        common: {
            name: "Common Bee",
            damage: 10,
            health: 10,
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
            range: 100
        },
        uncommon: {
            name: "Common Bee",
            damage: 15,
            health: 15,
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
            range: 100
        },
        rare: {
            name: "Common Bee",
            damage: 20,
            health: 20,
            size: 1.5,
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
            range: 100
        },
        epic: {
            name: "Common Bee",
            damage: 25,
            health: 25,
            size: 1.8,
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
            range: 100
        },
        legendary: {
            name: "Common Bee",
            damage: 35,
            health: 35,
            size: 2.5,
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
            range: 100
        },
        mythic: {
            name: "Common Bee",
            damage: 50,
            health: 50,
            size: 3.0,
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
            range: 100
        }
    },
    ladybug: {
        common: {
            name: "Common Ladybug",
            damage: 10,
            health: 10,
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
            range: 100
        },
        uncommon: {
            name: "Common Ladybug",
            damage: 10,
            health: 20,
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
            range: 100
        },
        rare: {
            name: "Common Ladybug",
            damage: 15,
            health: 30,
            size: 1.4,
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
            range: 100
        },  
        epic: {
            name: "Common Ladybug",
            damage: 20,
            health: 25,
            size: 1.8,
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
            range: 100
        },
        legendary: {
            name: "Common Ladybug",
            damage: 25,
            health: 40,
            size: 2.5,
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
            range: 100
        },
        mythic: {
            name: "Common Ladybug",
            damage: 30,
            health: 60,
            size: 3.0,
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
            range: 100
        }
    },
    soldier_ant: {
        common: {
            name: "Common Soldier Ant",
            damage: 10,
            health: 10,
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
            range: 100
        },
        uncommon: {
            name: "Common Soldier Ant",
            damage: 10,
            health: 20,
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
            range: 200
        },
        rare: { 
            name: "Common Soldier Ant",
            damage: 15,
            health: 30,
            size: 1.4,
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
            range: 350
        },
        epic: {
            name: "Common Soldier Ant",
            damage: 20,
            health: 25,
            size: 1.8,
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
            range: 500
        },
        legendary: {
            name: "Common Soldier Ant",
            damage: 25,
            health: 40,
            size: 2.5,
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
            range: 600
        },
        mythic: {
            name: "Common Soldier Ant",
            damage: 30,
            health: 60,
            size: 3.0,
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
            range: 750
        }
    }
};

export function getMobStats(mobType: string, rarity: string): MobStats | null {
    return MOB_CONFIG[mobType]?.[rarity] || null;
}

export function getAllMobTypes(): string[] {
    return Object.keys(MOB_CONFIG);
}

export function getMobRarities(mobType: string): string[] {
    return Object.keys(MOB_CONFIG[mobType] || {});
}
