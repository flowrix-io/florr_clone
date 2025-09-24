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
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<ellipse cx="12" cy="16" rx="12" ry="9" fill="#ffff00"/>
<path d="M 0 80 A 8 8 0 0 0 24 18" stroke="black" fill="none" stroke-width="2"/>
  <path d="M 0 80 A 8 8 0 0 0 24 -14" stroke="black" fill="none" stroke-width="2" transform="scale(1, -1)"/>
<rect x="12" y="7" width="3" height="18" fill="#000000"/>
<rect x="4" y="10" width="3" height="12" fill="#000000"/>
<rect x="20" y="10" width="3" height="12" fill="#000000"/>
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
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<ellipse cx="12" cy="16" rx="12" ry="9" fill="#ffff00"/>
<path d="M 0 80 A 8 8 0 0 0 24 18" stroke="black" fill="none" stroke-width="2"/>
  <path d="M 0 80 A 8 8 0 0 0 24 -14" stroke="black" fill="none" stroke-width="2" transform="scale(1, -1)"/>
<rect x="12" y="7" width="3" height="18" fill="#000000"/>
<rect x="4" y="10" width="3" height="12" fill="#000000"/>
<rect x="20" y="10" width="3" height="12" fill="#000000"/>
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
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<ellipse cx="12" cy="16" rx="12" ry="9" fill="#ffff00"/>
<path d="M 0 80 A 8 8 0 0 0 24 18" stroke="black" fill="none" stroke-width="2"/>
  <path d="M 0 80 A 8 8 0 0 0 24 -14" stroke="black" fill="none" stroke-width="2" transform="scale(1, -1)"/>
<rect x="12" y="7" width="3" height="18" fill="#000000"/>
<rect x="4" y="10" width="3" height="12" fill="#000000"/>
<rect x="20" y="10" width="3" height="12" fill="#000000"/>
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
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<ellipse cx="12" cy="16" rx="12" ry="9" fill="#ffff00"/>
<path d="M 0 80 A 8 8 0 0 0 24 18" stroke="black" fill="none" stroke-width="2"/>
  <path d="M 0 80 A 8 8 0 0 0 24 -14" stroke="black" fill="none" stroke-width="2" transform="scale(1, -1)"/>
<rect x="12" y="7" width="3" height="18" fill="#000000"/>
<rect x="4" y="10" width="3" height="12" fill="#000000"/>
<rect x="20" y="10" width="3" height="12" fill="#000000"/>
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
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<ellipse cx="12" cy="16" rx="12" ry="9" fill="#ffff00"/>
<path d="M 0 80 A 8 8 0 0 0 24 18" stroke="black" fill="none" stroke-width="2"/>
  <path d="M 0 80 A 8 8 0 0 0 24 -14" stroke="black" fill="none" stroke-width="2" transform="scale(1, -1)"/>
<rect x="12" y="7" width="3" height="18" fill="#000000"/>
<rect x="4" y="10" width="3" height="12" fill="#000000"/>
<rect x="20" y="10" width="3" height="12" fill="#000000"/>
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
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<ellipse cx="12" cy="16" rx="12" ry="9" fill="#ffff00"/>
<path d="M 0 80 A 8 8 0 0 0 24 18" stroke="black" fill="none" stroke-width="2"/>
  <path d="M 0 80 A 8 8 0 0 0 24 -14" stroke="black" fill="none" stroke-width="2" transform="scale(1, -1)"/>
<rect x="12" y="7" width="3" height="18" fill="#000000"/>
<rect x="4" y="10" width="3" height="12" fill="#000000"/>
<rect x="20" y="10" width="3" height="12" fill="#000000"/>
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
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<defs>
  <!-- Define the second circle as the clipping path -->
  <clipPath id="cut-off-circle">
    <circle cx="16" cy="16" r="16" />
  </clipPath>
</defs>
<circle cx="16" cy="16" r="16" fill="#ff0000"/>
<circle cx="35" cy="16" r="12" fill="#000000" clip-path="url(#cut-off-circle)"/>
<circle cx="12" cy="23" r="4" fill="#000000"/>
<circle cx="16" cy="8" r="4" fill="#000000"/>
<circle cx="5" cy="14" r="4" fill="#000000"/>
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
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<defs>
  <!-- Define the second circle as the clipping path -->
  <clipPath id="cut-off-circle">
    <circle cx="16" cy="16" r="16" />
  </clipPath>
</defs>
<circle cx="16" cy="16" r="16" fill="#ff0000"/>
<circle cx="35" cy="16" r="12" fill="#000000" clip-path="url(#cut-off-circle)"/>
<circle cx="12" cy="23" r="4" fill="#000000"/>
<circle cx="16" cy="8" r="4" fill="#000000"/>
<circle cx="5" cy="14" r="4" fill="#000000"/>
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
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<defs>
  <!-- Define the second circle as the clipping path -->
  <clipPath id="cut-off-circle">
    <circle cx="16" cy="16" r="16" />
  </clipPath>
</defs>
<circle cx="16" cy="16" r="16" fill="#ff0000"/>
<circle cx="35" cy="16" r="12" fill="#000000" clip-path="url(#cut-off-circle)"/>
<circle cx="12" cy="23" r="4" fill="#000000"/>
<circle cx="16" cy="8" r="4" fill="#000000"/>
<circle cx="5" cy="14" r="4" fill="#000000"/>
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
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<defs>
  <!-- Define the second circle as the clipping path -->
  <clipPath id="cut-off-circle">
    <circle cx="16" cy="16" r="16" />
  </clipPath>
</defs>
<circle cx="16" cy="16" r="16" fill="#ff0000"/>
<circle cx="35" cy="16" r="12" fill="#000000" clip-path="url(#cut-off-circle)"/>
<circle cx="12" cy="23" r="4" fill="#000000"/>
<circle cx="16" cy="8" r="4" fill="#000000"/>
<circle cx="5" cy="14" r="4" fill="#000000"/>
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
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<defs>
  <!-- Define the second circle as the clipping path -->
  <clipPath id="cut-off-circle">
    <circle cx="16" cy="16" r="16" />
  </clipPath>
</defs>
<circle cx="16" cy="16" r="16" fill="#ff0000"/>
<circle cx="35" cy="16" r="12" fill="#000000" clip-path="url(#cut-off-circle)"/>
<circle cx="12" cy="23" r="4" fill="#000000"/>
<circle cx="16" cy="8" r="4" fill="#000000"/>
<circle cx="5" cy="14" r="4" fill="#000000"/>
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
            image: `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none">
<defs>
  <!-- Define the second circle as the clipping path -->
  <clipPath id="cut-off-circle">
    <circle cx="16" cy="16" r="16" />
  </clipPath>
</defs>
<circle cx="16" cy="16" r="16" fill="#ff0000"/>
<circle cx="35" cy="16" r="12" fill="#000000" clip-path="url(#cut-off-circle)"/>
<circle cx="12" cy="23" r="4" fill="#000000"/>
<circle cx="16" cy="8" r="4" fill="#000000"/>
<circle cx="5" cy="14" r="4" fill="#000000"/>
</svg>`,
            is_hostile: false,
            range: 100
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
